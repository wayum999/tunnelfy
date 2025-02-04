import * as path from 'path';
import * as Mocha from 'mocha';
import * as fs from 'fs';

function findTestFiles(dir: string): string[] {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    const files: string[] = [];
    
    for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        
        if (entry.isDirectory()) {
            files.push(...findTestFiles(fullPath));
        } else if (entry.name.endsWith('.test.js')) {
            console.log('Found test file:', fullPath);
            files.push(fullPath);
        }
    }
    
    return files;
}

export function run(): Promise<void> {
    // Create the mocha test
    const mocha = new Mocha({
        ui: 'bdd',
        color: true,
        timeout: 60000 // 60 seconds
    });

    // Add the extension test file directly
    const testFile = path.join(__dirname, 'extension.test.ts');
    console.log('Adding test file:', testFile);
    mocha.addFile(testFile);

    // Run the mocha test
    return new Promise<void>((resolve, reject) => {
        try {
            mocha.run(failures => {
                if (failures > 0) {
                    reject(new Error(`${failures} tests failed.`));
                } else {
                    resolve();
                }
            });
        } catch (err) {
            console.error('Error running tests:', err);
            reject(err);
        }
    });
}
