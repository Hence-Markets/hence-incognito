/// <reference types="vite/client" />

// The reused data layer is plain JS (allowJs). Declare the modules we import from
// .tsx so TypeScript treats them as `any` instead of erroring on missing types.
declare module '*.js';
