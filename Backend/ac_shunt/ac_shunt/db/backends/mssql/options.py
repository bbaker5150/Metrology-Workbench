"""ODBC option helpers shared by the application and its diagnostics."""

def with_mars(connection_string, enabled):
    """Replace the MARS keyword without touching semicolons in braced secrets."""
    parts = []
    start = index = 0
    braced = False
    while index < len(connection_string):
        char = connection_string[index]
        if braced:
            if char == "}":
                if connection_string[index:index + 2] == "}}":
                    index += 2
                    continue
                braced = False
        elif char == "{":
            prefix = connection_string[start:index].partition("=")
            if prefix[1] and not prefix[2].strip():
                braced = True
        elif char == ";":
            parts.append(connection_string[start:index])
            start = index + 1
        index += 1
    if braced:
        raise ValueError("Unterminated braced ODBC value.")
    parts.append(connection_string[start:])
    aliases = {"mars_connection", "multipleactiveresultsets"}
    preserved = [part for part in parts if part.strip()
                 and part.partition("=")[0].strip().lower() not in aliases]
    preserved.append("MARS_Connection=" + ("yes" if enabled else "no"))
    return ";".join(preserved)
