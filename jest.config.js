/** @type {import('jest').Config} */
module.exports = {
  preset: "ts-jest",
  testEnvironment: "node",
  roots: ["<rootDir>/src"],
  // Only run tests in the lib folder (calculator tests).
  // Exclude app folder (Next.js pages — not unit-testable with this setup).
  testMatch: ["<rootDir>/src/lib/**/*.test.ts"],
};
