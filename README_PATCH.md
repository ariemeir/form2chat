README_PATCH.md (Reference POC form)

What this patch does
- Replaces the demo form definition with a "Reference POC info collection" flow:
  - ref_name
  - ref_email (validated as email)
  - ref_relationship (select)
  - ref_relationship_explanation (optional)

How to apply
1) Unzip into your project root (same folder that contains package.json).
   It will overwrite: forms/demo.json

2) Restart dev server:
   Ctrl+C
   npm run dev

3) Open:
   http://localhost:3000/demo
