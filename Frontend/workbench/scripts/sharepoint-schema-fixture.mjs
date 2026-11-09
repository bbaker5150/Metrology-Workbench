// SharePoint applies the same field constraint when adding a column and
// when changing the item-level read policy on a list with existing columns.
const privateUniqueError = 'A list for which users can only view their own items cannot have fields that enforce unique values.';
const invalid = (value, status) => ({ status, body: { error: { message: { value } } } });

export function createSchemaFixture() {
  const fields = new Map();
  const security = new Map();
  function handle(path, method, data) {
    const list = /getbytitle\('([^']+)'\)/.exec(path)?.[1];
    if (!list) return;
    const columns = fields.get(list) || [];
    const access = security.get(list) || { ReadSecurity: 1, WriteSecurity: 1 };
    if (method === 'GET' && path.includes('ReadSecurity,WriteSecurity')) return { body: access };
    if (method === 'MERGE' && /getbytitle\('[^']+'\)$/.test(path)) {
      const update = JSON.parse(data);
      const required = {
        'Uncertalytics - Instruments': [2, 4],
        'Uncertalytics - Instrument Drafts': [2, 2],
        'Uncertalytics - Published Instruments': [1, 4],
      }[list];
      if (!required || update.ReadSecurity !== required[0] || update.WriteSecurity !== required[1] || Object.keys(update).length !== 2) {
        return invalid('Unexpected list access settings.', 400);
      }
      if (update.ReadSecurity === 2 && columns.some(field => field.EnforceUniqueValues)) return invalid(privateUniqueError, 500);
      security.set(list, update);
      return { body: {} };
    }
    if (method === 'GET' && path.includes('/fields?$select=InternalName')) {
      const name = /\$filter=InternalName eq '([^']+)'/.exec(path)?.[1];
      return { body: { value: name ? columns.filter(field => field.InternalName === name) : columns } };
    }
    if (method === 'POST' && path.endsWith('/fields/createfieldasxml')) {
      const { SchemaXml } = JSON.parse(data).parameters;
      const field = {
        InternalName: / Name="([^"]+)"/.exec(SchemaXml)[1],
        Indexed: / Indexed="TRUE"/i.test(SchemaXml),
        EnforceUniqueValues: / EnforceUniqueValues="TRUE"/i.test(SchemaXml),
      };
      if (field.EnforceUniqueValues && access.ReadSecurity === 2) return invalid(privateUniqueError, 500);
      if (columns.some(column => column.InternalName === field.InternalName)) return invalid('A column with this name already exists.', 400);
      fields.set(list, [...columns, field]);
      return { body: field };
    }
    if (method === 'MERGE' && path.endsWith("/fields/getbyinternalnameortitle('RecordId')")) {
      const update = JSON.parse(data);
      const field = columns.find(column => column.InternalName === 'RecordId');
      if (!field) return invalid('Column does not exist.', 404);
      if (update.EnforceUniqueValues !== false || Object.keys(update).length !== 1) return invalid('Unexpected field update.', 400);
      field.EnforceUniqueValues = false;
      return { body: field };
    }
  }
  return { fields, security, handle };
}

export function directoryGroups(path, memberships, siteGroups) {
  if (path.includes('/_api/web/currentuser/groups?')) return { value: memberships.map(Title => ({ Title })) };
  if (path.includes('/_api/web/sitegroups?')) {
    const name = /\$filter=Title eq '([^']+)'/.exec(path)?.[1];
    return { value: siteGroups.filter(title => !name || title === name).map(Title => ({ Title })) };
  }
}
