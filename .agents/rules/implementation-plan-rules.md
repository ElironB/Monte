---
trigger: always_on
---

# Implementation Plan Generation Rule (`implementation-plan-rule.md`)

**Objective:** Generate hyper-specific, zero-ambiguity implementation plans that guarantee one-shot AI code generation. The plan must eliminate all architectural guessing, provide exact file paths, define concrete data structures, and establish strict negative constraints.

When creating an implementation plan, you MUST adhere to the following structure and guidelines:

## 1. Overview & Context ("The Why")

Start with a brief, conceptual overview of what is being built and _why_. AI models use this context to weigh semantic decisions (e.g., naming variables, logging).

- **Define the entity:** What is the new feature, class, or component?
- **Define the value:** What does it achieve conceptually within the broader system?

## 2. Surgical Wiring (The "Where")

Do not let the AI guess where to register new features or how to wire them into the existing system. Provide a numbered list of exact modifications.

- **Use Exact File Paths:** Use absolute or project alias paths (e.g., `@/home/Monte/src/api/...`).
- **Specify Insertion Points:** Indicate the exact line numbers (e.g., `line ~17`), union types, arrays, or Zod schemas to update.
- **Provide Injection Snippets:** Supply the exact code snippet required for the modification.

## 3. Interfaces & Data Contracts

Before defining business logic, define the exact shape of the data the AI will be working with.

- **Define Internal Types:** Provide the exact TypeScript `interface` or `type` definitions for inputs and outputs.
- **Detail External Data Shapes:** If parsing external data, outline the exact JSON structure/schema of that data so the AI doesn't hallucinate API response formats.
- **Detection Logic:** Provide exact code blocks demonstrating how to detect or parse specific data variants (e.g., `if (content.includes('mapping')) return 'chatgpt';`).

## 4. Deterministic Core Logic

Remove the AI's ability to invent business rules, categories, or thresholds.

- **Provide Exact Constants:** Supply the exact Regex patterns, base confidence scores, and category names in code blocks.
- **Provide Explicit Mappings:** If mapping extracted data to existing models, state exactly how (e.g., "High delegation maps to high socialDependency").
- **Specify Operation Sequences:** Define the exact order of operations (e.g., "Try format A, then format B, then format C").

## 5. Architectural Skeleton & Internal Utilities

If creating a new file, dictate the skeleton to prevent the AI from reinventing the wheel.

- **Explicit Imports:** Show exactly which internal utilities and base classes to import. Block the use of unauthorized external libraries.
- **Class/Function Shell:** Provide the class signature, including implemented interfaces, `readonly` properties, and required public/private method signatures.

## 6. The "Anti-Scope" (Strict Negative Constraints)

End with a bolded **What NOT to do** section. Explicitly list boundaries to prevent hallucination and scope creep.

- **Block new dependencies:** Explicitly state not to add new packages to `package.json`.
- **Block schema mutations:** Explicitly state not to modify existing type unions or database schemas unless explicitly instructed in Section 2.
- **Block irrelevant logic:** explicitly state what data to ignore (e.g., "Do NOT extract AI responses").

---

### Formatting Checklist

- [ ] Use `Filepath:` headers or inline file paths for every file touched.
- [ ] Use code blocks (` ```typescript `) for all schemas, regex, interfaces, and skeletons.
- [ ] Use bulleted and numbered lists for readability.
- [ ] Ensure the "What NOT to do" section is present at the very bottom.
