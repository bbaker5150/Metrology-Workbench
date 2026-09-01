import { Document, Page, Text, View, StyleSheet } from "@react-pdf/renderer";

const styles = StyleSheet.create({
  page: { paddingTop: 36, paddingBottom: 36, paddingHorizontal: 36, fontFamily: "Times-Roman", fontSize: 12, color: "#000" },
  center: { textAlign: "center" },
  labName: { fontFamily: "Times-Bold", fontSize: 14, textAlign: "center" },
  title: { fontFamily: "Times-Bold", fontSize: 18, textAlign: "center" },
  statement: { textAlign: "justify", lineHeight: 1.15 },
  labelRow: { flexDirection: "row", marginTop: 1 },
  label: { width: 110 },
  signatureRule: { borderBottomWidth: 0.75, borderBottomColor: "#000", height: 14 },
  cell: { borderWidth: 0.75, borderColor: "#000", justifyContent: "center" },
  cellText: { textAlign: "center", paddingVertical: 2, paddingHorizontal: 2 },
});

const DEFAULT_ORDER = [
  "letterhead", "title", "instrument", "customer", "statements",
  "inline_results", "statements_rest", "environment", "signatures",
];

function formatDate(iso) {
  if (!iso) return "";
  const date = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(date.getTime())) return String(iso);
  const month = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"][date.getMonth()];
  return `${String(date.getDate()).padStart(2, "0")}${month}${date.getFullYear()}`;
}

function formatEnvironment(value) {
  const number = Number.parseFloat(value);
  return Number.isNaN(number) ? String(value ?? "") : number.toFixed(1);
}

function formatCell(value) {
  if (value === null || value === undefined) return "";
  if (typeof value === "number" && !Number.isInteger(value)) {
    return String(value).length > 12 ? String(+value.toPrecision(10)) : String(value);
  }
  return String(value);
}

function Letterhead() {
  return <View>
    <Text style={styles.center}>Department of the Navy</Text>
    <Text style={styles.center}>NAVAIR North Island, Bldg. 469-S</Text>
    <Text style={styles.center}>San Diego, CA 92135</Text>
    <Text style={[styles.labName, { marginTop: 14 }]}>Navy Primary Standards Laboratory</Text>
    <Text style={styles.center}>(COM) 619-545-9705 (DSN) 735-9705 (FAX) 619-545-9861</Text>
  </View>;
}

function InstrumentIdentity({ data }) {
  return <View style={{ marginTop: 8 }}>
    {[["Manufacturer:", data.manufacturer], ["Model:", data.model_number], ["Serial:", data.serial_number]].map(([label, value]) => (
      <View key={label} style={styles.labelRow}><Text style={styles.label}>{label}</Text><Text>{value}</Text></View>
    ))}
  </View>;
}

function InlineResults({ rows }) {
  if (!rows?.length) return null;
  return <View style={{ marginTop: 10, marginBottom: 2 }}>
    {rows.map((row, index) => {
      const [label1, value1, label2, value2] = [...row, "", "", "", ""];
      return <View key={index} style={{ flexDirection: "row", marginTop: 1 }}>
        <View style={{ flexDirection: "row", width: "50%", justifyContent: "center" }}>
          {label1 ? <><Text style={{ width: 90, textAlign: "right" }}>{label1}</Text><Text style={{ width: 26, textAlign: "center" }}>=</Text><Text style={{ width: 150 }}>{formatCell(value1)}</Text></> : null}
        </View>
        <View style={{ flexDirection: "row", width: "50%", justifyContent: "center" }}>
          {label2 ? <><Text style={{ width: 60, textAlign: "right" }}>{label2}</Text><Text style={{ width: 26, textAlign: "center" }}>=</Text><Text style={{ width: 150 }}>{formatCell(value2)}</Text></> : null}
        </View>
      </View>;
    })}
  </View>;
}

function Environment({ data }) {
  return <View style={{ marginTop: 14 }}>
    <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
      <View style={{ flexDirection: "row" }}><Text style={{ width: 130 }}>Ambient Temperature:</Text><Text style={{ width: 40, textAlign: "right" }}>{formatEnvironment(data.ambient_temperature)}</Text><Text> °C</Text></View>
      <View style={{ flexDirection: "row" }}><Text>Calibration Date:  </Text><Text style={{ width: 80, textAlign: "right" }}>{formatDate(data.calibration_date)}</Text></View>
    </View>
    <View style={{ flexDirection: "row", justifyContent: "space-between", marginTop: 2 }}>
      <View style={{ flexDirection: "row" }}><Text style={{ width: 130 }}>Relative Humidity:</Text><Text style={{ width: 40, textAlign: "right" }}>{formatEnvironment(data.relative_humidity)}</Text><Text> %</Text></View>
      <View style={{ flexDirection: "row" }}><Text>Due Date:  </Text><Text style={{ width: 80, textAlign: "right" }}>{formatDate(data.due_date)}</Text></View>
    </View>
  </View>;
}

function Signatures({ data }) {
  const signature = (label, name, title) => <View style={{ flexDirection: "row", width: "48%" }}>
    <Text style={{ width: label === "Metrologist:" ? 68 : 78 }}>{label}</Text>
    <View style={{ flex: 1 }}><View style={styles.signatureRule} /><Text style={styles.center}>{name}</Text><Text style={[styles.center, { marginTop: 4 }]}>{title}</Text></View>
  </View>;
  return <View style={{ marginTop: 26, flexDirection: "row", justifyContent: "space-between" }}>
    {signature("Metrologist:", data.metrologist_name, data.metrologist_title)}
    {signature("Approved by:", data.approver_name, data.approver_title)}
  </View>;
}

function Footer({ data, page, pages }) {
  return <View style={{ position: "absolute", bottom: 30, left: 36, right: 36, flexDirection: "row" }} fixed>
    <View style={{ flexDirection: "row", width: "33%" }}><Text>RoC #:  </Text><Text>{data.roc_number}</Text></View>
    <Text style={{ width: "34%", textAlign: "center" }}>{`Page ${page} of ${pages}`}</Text>
    <View style={{ flexDirection: "row", width: "33%", justifyContent: "flex-end" }}><Text>Issue Date:  </Text><Text>{formatDate(data.issue_date)}</Text></View>
  </View>;
}

function DataTable({ table }) {
  const columns = table.columns || [];
  if (!columns.length) return null;
  const rows = table.rows || [];
  const width = Math.min(85, Math.max(45, columns.length * 18));
  return <View style={{ marginTop: 14 }}>
    {table.intro_text ? <Text style={[styles.statement, { marginBottom: 10 }]}>{table.intro_text}</Text> : null}
    {table.title ? <Text style={[styles.center, { marginBottom: 6 }]}>{table.title}</Text> : null}
    <View style={{ width: `${width}%`, alignSelf: "center", fontSize: columns.length > 4 ? 10 : 12 }}>
      <View style={{ flexDirection: "row" }} wrap={false}>
        {columns.map((column, index) => <View key={index} style={[styles.cell, { flex: 1, marginLeft: index ? -0.75 : 0 }]}>
          {String(column.header || "").split("\n").map((line, lineIndex) => <Text key={lineIndex} style={styles.cellText}>{line}</Text>)}
          {column.unit ? <Text style={styles.cellText}>{column.unit}</Text> : null}
        </View>)}
      </View>
      {rows.map((row, rowIndex) => <View key={rowIndex} style={{ flexDirection: "row", marginTop: -0.75 }} wrap={false}>
        {columns.map((_, columnIndex) => <View key={columnIndex} style={[styles.cell, { flex: 1, marginLeft: columnIndex ? -0.75 : 0 }]}><Text style={styles.cellText}>{formatCell(row[columnIndex])}</Text></View>)}
      </View>)}
    </View>
  </View>;
}

export default function CalibrationPDF({ data, sections }) {
  const list = sections?.length ? sections : DEFAULT_ORDER.map((id) => ({ id, visible: true }));
  const isVisible = (id) => list.find((section) => section.id === id)?.visible ?? true;
  const statements = data.statements || [];
  const [technical, ...remainingStatements] = statements;
  const tables = isVisible("tables") ? data.tables || [] : [];
  const pages = tables.length ? 2 : 1;

  const blocks = {
    letterhead: () => <Letterhead />,
    title: () => <View><Text style={[styles.title, { marginTop: 16 }]}>Report of Calibration</Text><Text style={[styles.center, { marginTop: 10 }]}>for</Text><Text style={styles.center}>{data.nomenclature}</Text></View>,
    instrument: () => <InstrumentIdentity data={data} />,
    customer: () => <View style={{ marginTop: 6 }}><Text style={styles.center}>{data.submitted_label || "Submitted by:"}</Text><Text style={styles.center}>{data.customer_name}</Text><Text style={styles.center}>{data.customer_address}</Text></View>,
    statements: () => <View>{technical ? <Text style={[styles.statement, { marginTop: 12 }]}>{technical.text}</Text> : null}{data.procedure_used ? <View style={[styles.labelRow, { marginTop: 8 }]}><Text style={styles.label}>Procedure Used:</Text><Text>{data.procedure_used}</Text></View> : null}</View>,
    inline_results: () => <InlineResults rows={data.inline_results} />,
    statements_rest: () => <View>{remainingStatements.map((statement, index) => <Text key={index} style={[styles.statement, { marginTop: 10 }]}>{statement.text}</Text>)}</View>,
    environment: () => <Environment data={data} />,
    signatures: () => <Signatures data={data} />,
  };
  const presentIds = new Set(list.map((section) => section.id));
  const ordered = list.filter((section) => section.visible && blocks[section.id]);
  const missing = DEFAULT_ORDER.filter((id) => !presentIds.has(id));

  return <Document title={`ROC ${data.roc_number || ""}`}>
    <Page size="LETTER" style={styles.page}>
      {ordered.map((section) => <View key={section.id}>{blocks[section.id]()}</View>)}
      {missing.map((id) => <View key={id}>{blocks[id]()}</View>)}
      <Footer data={data} page={1} pages={pages} />
    </Page>
    {tables.length ? <Page size="LETTER" style={styles.page}>
      <View>
        <View style={styles.labelRow}><Text style={styles.label}>Nomenclature:</Text><Text style={{ flex: 1 }}>{data.nomenclature}</Text><Text>Calibration Date:  {formatDate(data.calibration_date)}</Text></View>
        <View style={styles.labelRow}><Text style={styles.label}>Manufacturer:</Text><Text style={{ flex: 1 }}>{data.manufacturer}</Text><Text>Due Date:  {formatDate(data.due_date)}</Text></View>
        <View style={styles.labelRow}><Text style={styles.label}>Model:</Text><Text>{data.model_number}</Text></View>
        <View style={styles.labelRow}><Text style={styles.label}>Serial:</Text><Text>{data.serial_number}</Text></View>
      </View>
      {tables.map((table, index) => <DataTable key={index} table={table} />)}
      <Footer data={data} page={2} pages={pages} />
    </Page> : null}
  </Document>;
}
