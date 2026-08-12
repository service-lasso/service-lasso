import type { ISizeCalculationResult } from "./index.js";
export declare function setConcurrency(concurrency: number): void;
export declare function imageSizeFromFile(filePath: string): Promise<ISizeCalculationResult>;
