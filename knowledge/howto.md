---
title: How to work with the knowledge base
description: This file explains the rules of the knowledge base.
---

Each file in the knowledge folder is strictly in the format of markdown WITH frontmatter. Folder "human" could be written only by human, do not touch it unless human asks you to do so.

## File structure

Each file MUST start with the following frontmatter block:

```markdown
---
title: <title>
description: <description>
---
```

## Directory structure

Everything must be stored in the knowledge folder, human writes files in the "human" folder, bot/ai/assistant/agent writes files in the "bot" folder. "reports" folder is used to store external deep research reports for you to use.

## How to write to a knowledge base

Important: 
- Write the files in the bot folder always. Read any file you wish.
- Folder structure should be flat, do not create subfolders.
- File names should be similar to the file existing, it should be prefixed by submodule name like "language-...." when defining a new language feature.
- Any file has a title, description. First section of the content should be a few sentences describing the idea. Then next section should be more detailed. And in the end it should contain 
- Any time you want to write something to a markdown - write it to the knowledge base, not next to the existing file.

## Typescript-inspired logic

When you want to describe a feature, you must write an interface for it using typescript types. Never use any code itself, only types. Each type should be well documented. Before writing types, you should group them from higher level to lover level and write them this way in a same file. Each type (or some group of closely related types) should be prefixed with idea description.
