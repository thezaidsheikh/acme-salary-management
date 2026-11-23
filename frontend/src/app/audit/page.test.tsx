import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import AuditLogPage from "./page";
import { api, type AuditLogRow, type PageMeta } from "@/features/employees/api";

// Mock only listAuditLog; the rest of the client stays real.
vi.mock("@/features/employees/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/features/employees/api")>();
  return { ...actual, api: { ...actual.api, listAuditLog: vi.fn() } };
});

// next/link needs no router context in this test — render a plain anchor.
vi.mock("next/link", () => ({
  default: ({ href, children, className }: { href: string; children: React.ReactNode; className?: string }) => (
    <a href={href} className={className}>
      {children}
    </a>
  ),
}));

const listMock = vi.mocked(api.listAuditLog);

const priyaRow: AuditLogRow = {
  id: "h-1",
  employeeId: "emp-1",
  employeeName: "Priya Sharma",
  department: "Engineering",
  oldSalary: 150000,
  newSalary: 155000,
  currency: "INR",
  reason: "Annual appraisal",
  changedBy: "HR Manager",
  changedAt: "2026-03-20T09:00:00.000Z",
};

const rahulRow: AuditLogRow = {
  id: "h-2",
  employeeId: "emp-2",
  employeeName: "Rahul Verma",
  department: "Design",
  oldSalary: 8000,
  newSalary: 8300,
  currency: "USD",
  reason: "Promotion",
  changedBy: "Anita Desai",
  changedAt: "2026-02-15T09:00:00.000Z",
};

const meeraRow: AuditLogRow = {
  id: "h-3",
  employeeId: "emp-3",
  employeeName: "Meera Iyer",
  department: "Engineering",
  oldSalary: 110000,
  newSalary: 125000,
  currency: "INR",
  reason: "Annual appraisal",
  changedBy: "HR Manager",
  changedAt: "2026-01-10T09:00:00.000Z",
};

function meta(overrides: Partial<PageMeta> = {}): PageMeta {
  return { total: 2, page: 1, pageSize: 20, totalPages: 1, ...overrides };
}

describe("Audit log page", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders a loading state first", () => {
    listMock.mockResolvedValue({ data: [priyaRow], meta: meta() });
    render(<AuditLogPage />);
    expect(screen.getByText("Loading…")).toBeInTheDocument();
  });

  it("renders rows, total and pagination once loaded", async () => {
    listMock.mockResolvedValue({ data: [priyaRow, rahulRow], meta: meta() });
    render(<AuditLogPage />);
    expect(await screen.findByText("Priya Sharma")).toBeInTheDocument();
    expect(screen.getByText("Rahul Verma")).toBeInTheDocument();
    // Who changed whose salary, old → new, reason, and when.
    expect(screen.getByText("HR Manager")).toBeInTheDocument();
    expect(screen.getByText("Anita Desai")).toBeInTheDocument();
    expect(screen.getByText("₹150,000 → ₹155,000")).toBeInTheDocument();
    expect(screen.getByText("$8,000 → $8,300")).toBeInTheDocument();
    expect(screen.getByText("Annual appraisal")).toBeInTheDocument();
    expect(screen.getByText("Promotion")).toBeInTheDocument();
    expect(screen.getByText("2026-03-20 09:00")).toBeInTheDocument();
    expect(screen.getByText("Page 1 of 1 · 2 changes")).toBeInTheDocument();
    // Single page: both pagination buttons disabled.
    expect(screen.getByRole("button", { name: "Previous" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Next" })).toBeDisabled();
  });

  it("shows the empty state when nothing matches", async () => {
    listMock.mockResolvedValue({ data: [], meta: meta({ total: 0 }) });
    render(<AuditLogPage />);
    expect(await screen.findByText("No salary changes match these filters.")).toBeInTheDocument();
  });

  it("shows the error banner when the backend is unreachable", async () => {
    listMock.mockRejectedValue(new Error("boom"));
    render(<AuditLogPage />);
    expect(await screen.findByText(/Could not load audit log: boom/)).toBeInTheDocument();
  });

  it("sends the search value when the search box changes", async () => {
    listMock.mockResolvedValue({ data: [priyaRow], meta: meta({ total: 1 }) });
    render(<AuditLogPage />);
    await screen.findByText("Priya Sharma");
    fireEvent.change(screen.getByPlaceholderText("Search employee name or email…"), {
      target: { value: "Rahul" },
    });
    await waitFor(() =>
      expect(listMock).toHaveBeenCalledWith(
        expect.objectContaining({ search: "Rahul", page: 1, pageSize: 20 }),
      ),
    );
  });

  it("sends filter values when department and dates change", async () => {
    listMock.mockResolvedValue({ data: [rahulRow], meta: meta({ total: 1 }) });
    render(<AuditLogPage />);
    await screen.findByText("Rahul Verma");
    fireEvent.change(screen.getByLabelText("Department"), { target: { value: "Design" } });
    await waitFor(() =>
      expect(listMock).toHaveBeenCalledWith(expect.objectContaining({ department: "Design" })),
    );
    fireEvent.change(screen.getByLabelText("From date"), { target: { value: "2026-02-01" } });
    await waitFor(() =>
      expect(listMock).toHaveBeenCalledWith(expect.objectContaining({ from: "2026-02-01" })),
    );
    fireEvent.change(screen.getByLabelText("To date"), { target: { value: "2026-02-28" } });
    await waitFor(() =>
      expect(listMock).toHaveBeenCalledWith(
        expect.objectContaining({ from: "2026-02-01", to: "2026-02-28", department: "Design" }),
      ),
    );
  });

  it("paginates forward and back, disabling buttons at the ends", async () => {
    listMock.mockImplementation((params) =>
      Promise.resolve(
        params.page === 2
          ? { data: [meeraRow], meta: meta({ total: 3, page: 2, totalPages: 2 }) }
          : { data: [priyaRow, rahulRow], meta: meta({ total: 3, page: 1, totalPages: 2 }) },
      ),
    );
    render(<AuditLogPage />);
    expect(await screen.findByText("Priya Sharma")).toBeInTheDocument();
    expect(screen.getByText("Page 1 of 2 · 3 changes")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(await screen.findByText("Meera Iyer")).toBeInTheDocument();
    expect(screen.getByText("Page 2 of 2 · 3 changes")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Next" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Previous" }));
    expect(await screen.findByText("Priya Sharma")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Previous" })).toBeDisabled();
  });
});
