#!/usr/bin/env node

const fs = require('fs');
const matter = require('gray-matter');
const { globSync } = require('glob');

// Find all markdown files in the knowledge folder
const markdownFiles = globSync('knowledge/**/*.md', { cwd: process.cwd() });

console.log('Knowledge Base Files:\n');

markdownFiles.forEach((filePath) => {
    try {
        // Read the file
        const fileContent = fs.readFileSync(filePath, 'utf-8');

        // Parse frontmatter
        const { data } = matter(fileContent);

        // Extract title and description
        const title = data.title || 'No title';
        const description = data.description || 'No description';

        // Print the results
        console.log(`Path: ${filePath}`);
        console.log(`Title: ${title}`);
        console.log(`Description: ${description}`);
        console.log('');
    } catch (error) {
        console.error(`Error processing ${filePath}:`, error.message);
    }
});

console.log(`Total files scanned: ${markdownFiles.length}`);
