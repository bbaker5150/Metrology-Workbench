import { Document, Page, Text, View, Svg, Path, StyleSheet } from "@react-pdf/renderer";

// react-pdf's built-in "Times-Roman" is one of the 14 base PDF fonts — no
// font file to embed, so react-pdf skips real text shaping and just does a
// metrics-table lookup. That's why it's fast (~7ms/render). An embedded
// custom font (tried earlier, to get real Ω support everywhere) was 4-70x
// slower per render depending on how aggressively it was subsetted, because
// *any* embedded font forces real shaping on every render — there's no way
// to keep Base14 speed and also have Ω as a normal font glyph.
//
// Base14/WinAnsi has no Ω (U+03A9) glyph at all — react-pdf doesn't drop it,
// it silently maps it to whatever WinAnsi happens to have at that slot (©,
// in Times-Roman), which is worse than a blank. So Ω never reaches Base14
// text as a literal character:
//   - Short, single-line values (labels, table headers/cells, coefficient
//     lines) go through <OhmText>, which draws Ω as a tiny vector glyph
//     (OhmIcon, traced from Noto Serif's outline — SIL OFL) sitting inline
//     in a flex row next to plain Base14 Text siblings. This is NOT the
//     same as nesting an <Svg> inside <Text> — react-pdf's Text layout
//     silently drops non-Text children, so the split has to happen one
//     level up, in a flex View, which is why this only works for text that
//     never needs to line-wrap.
//   - Long justified paragraphs (statements, table intro text) genuinely
//     can't be split into a flex row without breaking justification/wrap,
//     so spellOutOhm() replaces Ω with the word "Ohm" there instead.
const OHM_PATH_D = "M49 0L42 175L94 175L101 132Q105 110 115 96.5Q125 83 145 76.5Q165 70 196 70L283 70L289 128Q216 153 162.5 191Q109 229 80.5 286.5Q52 344 52 427Q52 514 89 581Q126 648 199 686.5Q272 725 378 725Q479 725 551 689.5Q623 654 662 589.5Q701 525 701 438Q701 355 672.5 294.5Q644 234 591 193.5Q538 153 464 128L470 70L557 70Q589 70 608.5 76.5Q628 83 638.5 96.5Q649 110 652 132L659 175L711 175L704 0L429 0L414 169Q475 186 513.5 222Q552 258 571 312.5Q590 367 590 439Q590 513 568 564.5Q546 616 499 643.5Q452 671 378 671Q304 671 256 641Q208 611 185.5 556.5Q163 502 163 428Q163 356 182 304Q201 252 240 219Q279 186 339 169L325 0Z";
// Glyph is defined on a 1000-unit em, baseline at y=0, cap height ~714.

function OhmIcon({ fontSize = 12 }) {
  const scale = fontSize / 1000;
  return (
    <Svg width={753 * scale} height={725 * scale} viewBox="0 0 753 725" style={{ marginBottom: 0.2 * fontSize }}>
      <Path d={OHM_PATH_D} fill="#000" transform="matrix(1 0 0 -1 0 725)" />
    </Svg>
  );
}

function flattenStyle(style) {
  return Array.isArray(style) ? Object.assign({}, ...style.filter(Boolean)) : style || {};
}

/** Drop-in replacement for <Text style={style}>{children}</Text> that draws
 * any Ω as a vector OhmIcon instead of letting it hit Base14/WinAnsi (see
 * module comment). Only for text that renders on one line — do not use for
 * justified/wrapping paragraphs. */
function OhmText({ style, children }) {
  const text = children == null ? "" : String(children);
  if (!text.includes("Ω")) return <Text style={style}>{text}</Text>;
  // `width`/`textAlign` size and align the *whole* label within its row —
  // they belong on the wrapping row below, not repeated on every fragment
  // (which previously gave each split piece its own full-width box and made
  // them wrap/overlap instead of sitting side by side).
  const { width, textAlign, ...fragmentStyle } = flattenStyle(style);
  const justify = textAlign === "center" ? "center" : textAlign === "right" ? "flex-end" : "flex-start";
  const parts = text.split("Ω");
  const nodes = [];
  parts.forEach((part, index) => {
    if (part) nodes.push(<Text key={`t${index}`} style={fragmentStyle}>{part}</Text>);
    if (index < parts.length - 1) nodes.push(<OhmIcon key={`o${index}`} fontSize={fragmentStyle.fontSize || 12} />);
  });
  return <View style={{ flexDirection: "row", flexWrap: "nowrap", justifyContent: justify, alignItems: "flex-end", width }}>{nodes}</View>;
}

/** For justified/wrapping paragraph text, where OhmText's flex-row split
 * would break line-wrapping — spell Ω out instead. */
function spellOutOhm(text) {
  return String(text ?? "").replace(/Ω/g, "Ohm");
}

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
      <View key={label} style={styles.labelRow}><Text style={styles.label}>{label}</Text><OhmText>{value}</OhmText></View>
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
          {label1 ? <><OhmText style={{ width: 90, textAlign: "right" }}>{label1}</OhmText><Text style={{ width: 26, textAlign: "center" }}>=</Text><OhmText style={{ width: 150 }}>{formatCell(value1)}</OhmText></> : null}
        </View>
        <View style={{ flexDirection: "row", width: "50%", justifyContent: "center" }}>
          {label2 ? <><OhmText style={{ width: 60, textAlign: "right" }}>{label2}</OhmText><Text style={{ width: 26, textAlign: "center" }}>=</Text><OhmText style={{ width: 150 }}>{formatCell(value2)}</OhmText></> : null}
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
    <View style={{ flex: 1 }}><View style={styles.signatureRule} /><OhmText style={styles.center}>{name}</OhmText><OhmText style={[styles.center, { marginTop: 4 }]}>{title}</OhmText></View>
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
  const cellFontSize = columns.length > 4 ? 10 : 12;
  return <View style={{ marginTop: 14 }}>
    {table.intro_text ? <Text style={[styles.statement, { marginBottom: 10 }]}>{spellOutOhm(table.intro_text)}</Text> : null}
    {table.title ? <OhmText style={[styles.center, { marginBottom: 6 }]}>{table.title}</OhmText> : null}
    <View style={{ width: `${width}%`, alignSelf: "center", fontSize: cellFontSize }}>
      <View style={{ flexDirection: "row" }} wrap={false}>
        {columns.map((column, index) => <View key={index} style={[styles.cell, { flex: 1, marginLeft: index ? -0.75 : 0 }]}>
          {String(column.header || "").split("\n").map((line, lineIndex) => <OhmText key={lineIndex} style={styles.cellText}>{line}</OhmText>)}
          {column.unit ? <OhmText style={styles.cellText}>{column.unit}</OhmText> : null}
        </View>)}
      </View>
      {rows.map((row, rowIndex) => <View key={rowIndex} style={{ flexDirection: "row", marginTop: -0.75 }} wrap={false}>
        {columns.map((_, columnIndex) => <View key={columnIndex} style={[styles.cell, { flex: 1, marginLeft: columnIndex ? -0.75 : 0 }]}><OhmText style={styles.cellText}>{formatCell(row[columnIndex])}</OhmText></View>)}
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
    title: () => <View><Text style={[styles.title, { marginTop: 16 }]}>Report of Calibration</Text><Text style={[styles.center, { marginTop: 10 }]}>for</Text><OhmText style={styles.center}>{data.nomenclature}</OhmText></View>,
    instrument: () => <InstrumentIdentity data={data} />,
    customer: () => <View style={{ marginTop: 6 }}><Text style={styles.center}>{data.submitted_label || "Submitted by:"}</Text><OhmText style={styles.center}>{data.customer_name}</OhmText><OhmText style={styles.center}>{data.customer_address}</OhmText></View>,
    statements: () => <View>{technical ? <Text style={[styles.statement, { marginTop: 12 }]}>{spellOutOhm(technical.text)}</Text> : null}{data.procedure_used ? <View style={[styles.labelRow, { marginTop: 8 }]}><Text style={styles.label}>Procedure Used:</Text><OhmText>{data.procedure_used}</OhmText></View> : null}</View>,
    inline_results: () => <InlineResults rows={data.inline_results} />,
    statements_rest: () => <View>{remainingStatements.map((statement, index) => <Text key={index} style={[styles.statement, { marginTop: 10 }]}>{spellOutOhm(statement.text)}</Text>)}</View>,
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
        <View style={styles.labelRow}><Text style={styles.label}>Nomenclature:</Text><OhmText style={{ flex: 1 }}>{data.nomenclature}</OhmText><Text>Calibration Date:  {formatDate(data.calibration_date)}</Text></View>
        <View style={styles.labelRow}><Text style={styles.label}>Manufacturer:</Text><OhmText style={{ flex: 1 }}>{data.manufacturer}</OhmText><Text>Due Date:  {formatDate(data.due_date)}</Text></View>
        <View style={styles.labelRow}><Text style={styles.label}>Model:</Text><OhmText>{data.model_number}</OhmText></View>
        <View style={styles.labelRow}><Text style={styles.label}>Serial:</Text><OhmText>{data.serial_number}</OhmText></View>
      </View>
      {tables.map((table, index) => <DataTable key={index} table={table} />)}
      <Footer data={data} page={2} pages={pages} />
    </Page> : null}
  </Document>;
}
