export const restrictedPrismaImports = {
  files: ["src/**/*.ts"],
  ignores: ["**/repositories/**/*.ts", "**/src/seed.ts", "**/src/seed/**/*.ts"],
  rules: {
    "no-restricted-imports": [
      "error",
      {
        paths: [
          {
            name: "@prisma/client",
            message: "Direct imports of Prisma client are not allowed here. Use packages/database/src/repositories instead."
          },
          {
            name: "@agency-os/database",
            importNames: ["PrismaClient"],
            message: "Direct imports of Prisma client are not allowed here. Use packages/database/src/repositories instead."
          }
        ],
        patterns: [
          {
            group: [".prisma/client", ".prisma/client/*"],
            message: "Direct imports of generated Prisma client are not allowed here. Use packages/database/src/repositories instead."
          }
        ]
      }
    ]
  }
};

export const restrictedCryptoImports = {
  files: ["**/*.ts"],
  ignores: ["**/repositories/**/*.ts", "**/oauth/**/*.ts", "**/crypto/**/*.ts", "**/worker/src/sync/**/*.ts"],
  rules: {
    "no-restricted-imports": [
      "error",
      {
        paths: [
          {
            name: "@agency-os/database",
            importNames: ["encrypt", "decrypt"],
            message: "Direct imports of crypto utility are not allowed here. Only packages/database/repositories and the oauth module may import it."
          }
        ]
      }
    ]
  }
};
