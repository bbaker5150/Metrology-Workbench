from io import BytesIO
from unittest.mock import patch
from django.test import TestCase
from django.core.files.uploadedfile import SimpleUploadedFile
from openpyxl import Workbook
from rest_framework.test import APIRequestFactory
from . import views
from .customers import HEADERS, parse_customers, replace_customers
from .models import Customer, CustomerDirectory, ROCRecord


def workbook_upload(rows, headers=HEADERS):
    workbook = Workbook()
    workbook.active.append(list(headers))
    for row in rows:
        workbook.active.append(row)
    output = BytesIO()
    workbook.save(output)
    return SimpleUploadedFile('latest.xlsx', output.getvalue())


class CustomerDirectoryTests(TestCase):
    databases = {'default', 'reports'}

    @classmethod
    def setUpTestData(cls):
        Customer.objects.all().delete()
        Customer.objects.bulk_create([Customer(activity=f"CODE-{i}", sub_custodian=f"SUB-{i}",
            lab_name=f"Example Lab {i:02d}", address=f"{i} Example Street") for i in range(25)])
        CustomerDirectory.objects.update_or_create(pk=1, defaults={"source_name": "example.xlsx", "row_count": 25})

    def test_search_by_name_code_address_and_pagination(self):
        for query in ['SUB-24', 'Example Lab 24', '24 Example Street']:
            response = views.customer_search(APIRequestFactory().get('/customers/', {'q': query}))
            self.assertTrue(any(row['lab_name'] == 'Example Lab 24' for row in response.data['customers']))
        response = views.customer_search(APIRequestFactory().get('/customers/'))
        self.assertEqual(len(response.data['customers']), 20)
        self.assertGreater(response.data['pages'], 1)

    def test_import_replaces_directory_and_preserves_saved_reports(self):
        roc = ROCRecord.objects.create(customer_name='Original', customer_address='Saved address')
        upload = workbook_upload([['A', '001', 'New lab', 'New address', 'NAVAIR'], ['B', '', 'No address', '', '']])
        response = views.customer_import(APIRequestFactory().post('/customers/import/', {'file': upload}, format='multipart'))
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data['imported'], 2)
        self.assertEqual(response.data['missing_addresses'], 1)
        self.assertEqual(Customer.objects.count(), 2)
        self.assertEqual(CustomerDirectory.objects.get(pk=1).source_name, 'latest.xlsx')
        roc.refresh_from_db()
        self.assertEqual((roc.customer_name, roc.customer_address), ('Original', 'Saved address'))

    def test_invalid_empty_and_formula_imports_keep_directory(self):
        for upload in [workbook_upload([], ['Wrong header']), workbook_upload([]),
                       workbook_upload([['A', '', '=1+1', 'Address', '']]),
                       SimpleUploadedFile('bad.xlsx', b'not a workbook')]:
            response = views.customer_import(APIRequestFactory().post('/customers/import/', {'file': upload}, format='multipart'))
            self.assertEqual(response.status_code, 400)
            self.assertEqual(Customer.objects.count(), 25)

    def test_database_failure_rolls_back_replacement(self):
        with patch('django.db.models.query.QuerySet.bulk_create', side_effect=RuntimeError('write failed')):
            with self.assertRaises(RuntimeError):
                replace_customers([], 'broken.xlsx')
        self.assertEqual(Customer.objects.count(), 25)
        self.assertEqual(CustomerDirectory.objects.get(pk=1).source_name, 'example.xlsx')

    def test_duplicates_missing_names_and_reordered_headers(self):
        row = ['NAVAIR', 'Address', '', '001', 'A']
        rows, duplicates = parse_customers(workbook_upload([row, row], tuple(reversed(HEADERS))))
        self.assertEqual(len(rows), 1)
        self.assertEqual(duplicates, 1)
        self.assertEqual(rows[0]['sub_custodian'], '001')
        self.assertEqual(rows[0]['lab_name'], '')
