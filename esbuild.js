const esbuild = require("esbuild");

const production = process.argv.includes('--production');
const watch = process.argv.includes('--watch');

/**
 * @type {import('esbuild').Plugin}
 */
const esbuildProblemMatcherPlugin = {
    name: 'esbuild-problem-matcher',
    setup(build) {
        build.onStart(() => {
            console.log('[watch] build started');
        });
        build.onEnd((result) => {
            if (result.errors.length > 0) {
                result.errors.forEach(({ text, location }) => {
                    console.error(`✘ [ERROR] ${text}`);
                    if (location) {
                        console.error(`    ${location.file}:${location.line}:${location.column}:`);
                    }
                });
            } else {
                console.log('[watch] build completed successfully');
            }
        });
    },
};

async function main() {
    let ctx;
    try {
        ctx = await esbuild.context({
            entryPoints: ['src/extension.ts'],
            bundle: true,
            outfile: 'dist/extension.js',
            external: ['vscode'],
            format: 'cjs',
            platform: 'node',
            target: ['node16'],
            sourcemap: !production,
            minify: production,
            logLevel: 'info',
            plugins: [esbuildProblemMatcherPlugin],
        });

        if (watch) {
            console.log('[watch] watching for changes...');
            await ctx.watch();

            // Handle termination signals
            const cleanup = async () => {
                console.log('\n[watch] received termination signal, cleaning up...');
                if (ctx) {
                    await ctx.dispose();
                }
                process.exit(0);
            };

            process.on('SIGINT', cleanup);
            process.on('SIGTERM', cleanup);
            process.on('exit', cleanup);
        } else {
            console.log('[build] building...');
            await ctx.rebuild();
            await ctx.dispose();
            console.log('[build] build complete');
        }
    } catch (error) {
        console.error('Build failed:', error);
        if (ctx) {
            await ctx.dispose();
        }
        process.exit(1);
    }
}

main().catch((error) => {
    console.error('Fatal error:', error);
    process.exit(1);
});
