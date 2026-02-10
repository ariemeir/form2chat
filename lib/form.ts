import fs from "fs";
import path from "path";

export type Field =
  | {
      id: string;
      type: "text";
      label: string;
      required?: boolean;
      validation?: { kind?: "email" };
    }
  | {
      id: string;
      type: "number";
      label: string;
      required?: boolean;
      validation?: { min?: number; max?: number };
    }
  | {
      id: string;
      type: "date";
      label: string;
      required?: boolean;
    }
  | {
      id: string;
      type: "select" | "radio";
      label: string;
      required?: boolean;
      options?: string[];
    }
  | {
      id: string;
      type: "file";
      label: string;
      required?: boolean;
      validation?: { allowedMime?: string[] };
    };

export type FormDef = {
  id: string;
  title?: string;
  description?: string;
  targetCount?: number; // NEW: how many references to collect
  fields: Field[];
};

export function loadForm(formId: string): FormDef {
  const p = path.join(process.cwd(), "forms", `${formId}.json`);
  const raw = fs.readFileSync(p, "utf8");
  const parsed = JSON.parse(raw) as FormDef;

  if (!parsed?.id || !Array.isArray(parsed.fields)) {
    throw new Error(`Invalid form schema: ${p}`);
  }

  // default for old forms
  if (parsed.targetCount == null) parsed.targetCount = 1;

  return parsed;
}

