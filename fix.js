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
            
            const regex = /((?:import|export)\s+(?:[^'"]*?)\s+from\s+['"])(\.[^'"]+)(['"])/g;
            content = content.replace(regex, (match, prefix, importPath, suffix) => {
                if (importPath.endsWith('.js') || importPath.endsWith('.mjs') || importPath.endsWith('.json') || importPath.endsWith('.css')) return match;
                
                const absoluteImportPath = path.resolve(path.dirname(fullPath), importPath);
                let newImportPath = importPath;
                if (fs.existsSync(absoluteImportPath) && fs.statSync(absoluteImportPath).isDirectory()) {
                    newImportPath += '/index.js';
                } else {
                    newImportPath += '.js';
                }
                changed = true;
                return `${prefix}${newImportPath}${suffix}`;
            });
            
            const dynamicRegex = /(import\s*\(\s*['"])(\.[^'"]+)(['"]\s*\))/g;
            content = content.replace(dynamicRegex, (match, prefix, importPath, suffix) => {
                if (importPath.endsWith('.js') || importPath.endsWith('.mjs') || importPath.endsWith('.json')) return match;
                
                const absoluteImportPath = path.resolve(path.dirname(fullPath), importPath);
                let newImportPath = importPath;
                if (fs.existsSync(absoluteImportPath) && fs.statSync(absoluteImportPath).isDirectory()) {
                    newImportPath += '/index.js';
                } else {
                    newImportPath += '.js';
                }
                changed = true;
                return `${prefix}${newImportPath}${suffix}`;
            });
            
            const sideEffectRegex = /(import\s+['"])(\.[^'"]+)(['"])/g;
            content = content.replace(sideEffectRegex, (match, prefix, importPath, suffix) => {
                if (importPath.endsWith('.js') || importPath.endsWith('.mjs') || importPath.endsWith('.json') || importPath.endsWith('.css')) return match;
                
                const absoluteImportPath = path.resolve(path.dirname(fullPath), importPath);
                let newImportPath = importPath;
                if (fs.existsSync(absoluteImportPath) && fs.statSync(absoluteImportPath).isDirectory()) {
                    newImportPath += '/index.js';
                } else {
                    newImportPath += '.js';
                }
                changed = true;
                return `${prefix}${newImportPath}${suffix}`;
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
