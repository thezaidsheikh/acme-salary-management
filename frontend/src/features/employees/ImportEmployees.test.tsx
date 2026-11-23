import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import ImportEmployees from "./ImportEmployees";
import { api, type ImportReport } from "./api";

// Mock only importEmployees; the rest of the api client stays real.
vi.mock("./api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./api")>();
  return { ...actual, api: { ...actual.api, importEmployees: vi.fn() } };
});

const importMock = vi.mocked(api.importEmployees);

function report(overrides: Partial<ImportReport> = {}): ImportReport {
  return { totalRows: 3, imported: 2, failed: [{ row: 3, reason: "baseSalary: Expected number, received nan" }], ...overrides };
}

function pickFile() {
  const file = new File(["id,firstName\n,Asha"], "import.csv", { type: "text/csv" });
  fireEvent.change(screen.getByLabelText("CSV file to import"), { target: { files: [file] } });
  return file;
}

describe("ImportEmployees", () => {
  const onImported = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders the Import button and the sample CSV link", () => {
    render(<ImportEmployees onImported={onImported} />);
    expect(screen.getByRole("button", { name: "Import CSV" })).toBeInTheDocument();
    expect(screen.getByText("Download sample CSV").getAttribute("href")).toBe("/sample-employees.csv");
  });

  it("uploads the picked file and shows the report with failed rows, then refreshes the list", async () => {
    importMock.mockResolvedValue(report());
    render(<ImportEmployees onImported={onImported} />);
    const file = pickFile();
    expect(importMock).toHaveBeenCalledWith(file);
    expect(await screen.findByText("Imported 2 of 3 rows.")).toBeInTheDocument();
    expect(screen.getByText("Row 3: baseSalary: Expected number, received nan")).toBeInTheDocument();
    expect(onImported).toHaveBeenCalledTimes(1);
  });

  it("shows an all-imported message with no failed list when nothing failed", async () => {
    importMock.mockResolvedValue(report({ totalRows: 2, imported: 2, failed: [] }));
    render(<ImportEmployees onImported={onImported} />);
    pickFile();
    expect(await screen.findByText("Imported 2 of 2 rows.")).toBeInTheDocument();
    expect(screen.getByText("All rows imported successfully.")).toBeInTheDocument();
    expect(screen.queryByText(/Row \d+:/)).not.toBeInTheDocument();
  });

  it("shows the backend error and does not refresh the list when the upload fails", async () => {
    importMock.mockRejectedValue(new Error("Only .csv files are accepted"));
    render(<ImportEmployees onImported={onImported} />);
    pickFile();
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Import failed: Only .csv files are accepted",
    );
    expect(onImported).not.toHaveBeenCalled();
  });

  it("shows Importing… and disables the button while the upload is in flight", async () => {
    let resolveImport!: (r: ImportReport) => void;
    importMock.mockImplementation(
      () => new Promise<ImportReport>((resolve) => { resolveImport = resolve; }),
    );
    render(<ImportEmployees onImported={onImported} />);
    pickFile();
    expect(await screen.findByRole("button", { name: "Importing…" })).toBeDisabled();
    resolveImport(report({ totalRows: 1, imported: 1, failed: [] }));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Import CSV" })).not.toBeDisabled(),
    );
  });

  it("does nothing when the file dialog is cancelled (no file chosen)", () => {
    importMock.mockResolvedValue(report());
    render(<ImportEmployees onImported={onImported} />);
    fireEvent.change(screen.getByLabelText("CSV file to import"), { target: { files: [] } });
    expect(importMock).not.toHaveBeenCalled();
    expect(onImported).not.toHaveBeenCalled();
  });
});
