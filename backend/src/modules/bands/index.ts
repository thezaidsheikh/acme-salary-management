/**
 * Public API of the bands module. Other modules import through this
 * file only — never through the module's internal files — so the module's
 * boundary stays explicit and refactorable. Only types, the repository
 * interface and the module factory are public; concrete repository
 * classes live in bands.repository.ts.
 */
export type {
  BandPosition,
  BandSalaryPoint,
  BandSummary,
  EmployeeBandInfo,
  SalaryBand,
} from "./bands.types.js";
export type { BandRepository } from "./bands.repository.js";
export { InMemoryBandRepository } from "./bands.repository.js";
export { BandService, classifySalary, type BandEmployeeInput } from "./bands.service.js";
export { createBandsModule } from "./bands.factory.js";
