const fs = require('fs');
const path = require('path');

const packages = ['database', 'providers', 'session', 'shared', 'types'];
const basePath = path.join(process.cwd(), 'packages');

function processDir(dir) {
    if (!fs.existsSync(dir)) return;
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            if (entry.name !== 'node_modules' && entry.name !== 'dist') {
                processDir(fullPath);
            }
        } else if (entry.isFile() && (fullPath.endsWith('.ts') || fullPath.endsWith('.tsx')) && !fullPath.endsWith('.d.ts')) {
            let content = fs.readFileSync(fullPath, 'utf8');
            let changed = false;
            
            const regex = /(import|export)(.*?)from\s+(['"])(\.[^'"]+)\3/g;
            content = content.replace(regex, (match, p1, p2, quote, importPath) => {
                if (importPath.endsWith('.js') || importPath.endsWith('.mjs') || importPath.endsWith('.json') || importPath.endsWith('.css')) {
                    return match;
                }
                const absoluteImportPath = path.resolve(path.dirname(fullPath), importPath);
                let newImportPath = importPath;
                if (fs.existsSync(absoluteImportPath) && fs.statSync(absoluteImportPath).isDirectory()) {
                    newImportPath += '/index.js';
                } else {
                    newImportPath += '.js';
                }
                changed = true;
                return `${p1}${p2}from ${quote}${newImportPath}${quote}`;
            });
            
            const dynamicRegex = /import\s*\(\s*(['"])(\.[^'"]+)\1\s*\)/g;
            content = content.replace(dynamicRegex, (match, quote, importPath) => {
                if (importPath.endsWith('.js') || importPath.endsWith('.mjs') || importPath.endsWith('.json')) {
                    return match;
                }
                const absoluteImportPath = path.resolve(path.dirname(fullPath), importPath);
                let newImportPath = importPath;
                if (fs.existsSync(absoluteImportPath) && fs.statSync(absoluteImportPath).isDirectory()) {
                    newImportPath += '/index.js';
                } else {
                    newImportPath += '.js';
                }
                changed = true;
                return `import(${quote}${newImportPath}${quote})`;
            });
            
            const sideEffectRegex = /import\s+(['"])(\.[^'"]+)\1/g;
            content = content.replace(sideEffectRegex, (match, quote, importPath) => {
                if (importPath.endsWith('.js') || importPath.endsWith('.mjs') || importPath.endsWith('.json') || importPath.endsWith('.css')) {
                    return match;
                }
                const absoluteImportPath = path.resolve(path.dirname(fullPath), importPath);
                let newImportPath = importPath;
                if (fs.existsSync(absoluteImportPath) && fs.statSync(absoluteImportPath).isDirectory()) {
                    newImportPath += '/index.js';
                } else {
                    newImportPath += '.js';
                }
                changed = true;
                return `import ${quote}${newImportPath}${quote}`;
            });
            
            if (changed) {
                fs.writeFileSync(fullPath, content, 'utf8');
                console.log(`Updated: ${fullPath}`);
            }
        }
    }
}

for (const pkg of packages) {
    processDir(path.join(basePath, pkg));
}
