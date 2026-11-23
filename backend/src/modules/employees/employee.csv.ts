/**
 * CSV parsing for the employee import, plus the one shared column list.
 *
 * The import accepts exactly the columns the CSV export produces, in the
 * same order, so an exported file imports back unchanged (round-trip).
 * The `id` column is accepted but ignored on import: every imported
 * employee gets a fresh id, so an export can never collide with
 * existing rows. `managerId` is not an export column, so imported
 * employees have no manager until one is set afterwards.
 */
export const EMPLOYEE_CSV_COLUMNS = [
  "id",
  "firstName",
  "lastName",
  "email",
  "department",
  "country",
  "currency",
  "jobTitle",
  "level",
  "baseSalary",
  "dateOfJoining",
] as const;

/**
 * Maximum accepted upload: 5 MB. At ~110 bytes a row that is roughly
 * 45,000 employees per file — far above a single HR spreadsheet — while
 * bounding memory (multer holds the file in RAM) and request time.
 */
export const MAX_IMPORT_FILE_BYTES = 5 * 1024 * 1024;

/**
 * Parse CSV text into rows of fields (RFC 4180: a quoted field may contain
 * commas, newlines and doubled quotes; CRLF and LF both end a row; a
 * leading BOM is stripped). Every physical record becomes one row,
 * including blank lines (as `[]`), so the caller's row number — header
 * is row 1 — always matches the file. No header handling here: the
 * caller checks the header and validates each row.
 * @param text Raw CSV text.
 * @returns One array of fields per record, in file order.
 */
export function parseCsv(text: string): string[][] {
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  let i = 0;
  /** Finish the current field and start the next one. */
  const pushField = (): void => {
    row.push(field);
    field = "";
  };
  /** Finish the current row (a blank line becomes `[]`). */
  const pushRow = (): void => {
    if (row.length === 0 && field === "") {
      rows.push([]);
    } else {
      pushField();
      rows.push(row);
    }
    row = [];
  };
  while (i < text.length) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
        } else {
          inQuotes = false;
          i += 1;
        }
      } else {
        field += ch;
        i += 1;
      }
    } else if (ch === '"' && field === "") {
      inQuotes = true;
      i += 1;
    } else if (ch === ",") {
      pushField();
      i += 1;
    } else if (ch === "\r") {
      if (text[i + 1] === "\n") i += 1;
      pushRow();
      i += 1;
    } else if (ch === "\n") {
      pushRow();
      i += 1;
    } else {
      field += ch;
      i += 1;
    }
  }
  if (field !== "" || row.length > 0) pushRow();
  return rows;
}
