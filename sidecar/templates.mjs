// Fixed answer formats for recurring tasks. A template turn runs with
// `outputFormat`, so the answer arrives as data the window renders itself.
// The window sends the task in the user's language; the schema lives here.

export const TEMPLATES = {
  changelog: {
    type: "object",
    properties: {
      title: { type: "string", description: "Version or period the changelog covers" },
      sections: {
        type: "array",
        items: {
          type: "object",
          properties: {
            heading: { type: "string", description: "e.g. Added, Changed, Fixed" },
            items: { type: "array", items: { type: "string" } },
          },
          required: ["heading", "items"],
        },
      },
    },
    required: ["title", "sections"],
  },
  review: {
    type: "object",
    properties: {
      summary: { type: "string" },
      findings: {
        type: "array",
        items: {
          type: "object",
          properties: {
            severity: { type: "string", enum: ["high", "medium", "low"] },
            file: { type: "string", description: "Path relative to the project folder" },
            line: { type: "integer" },
            issue: { type: "string" },
            fix: { type: "string" },
          },
          required: ["severity", "file", "issue"],
        },
      },
    },
    required: ["summary", "findings"],
  },
  tasks: {
    type: "object",
    properties: {
      tasks: {
        type: "array",
        items: {
          type: "object",
          properties: {
            title: { type: "string" },
            detail: { type: "string" },
            priority: { type: "string", enum: ["high", "medium", "low"] },
          },
          required: ["title", "priority"],
        },
      },
    },
    required: ["tasks"],
  },
};
