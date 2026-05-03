/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const REQUIRED_SERVER_FILES = [
	'bin/remote-ai-server',
	'node',
	'out/server-main.js',
	'product.json'
];

function validateRemoteServerTree(serverDir) {
	const resolved = path.resolve(serverDir);
	for (const file of REQUIRED_SERVER_FILES) {
		const fullPath = path.join(resolved, file);
		if (!fs.existsSync(fullPath)) {
			throw new Error(`Remote server package is missing required file: ${file}`);
		}
	}

	return {
		serverDir: resolved,
		requiredFiles: [...REQUIRED_SERVER_FILES]
	};
}

function createRemoteServerManifest(options) {
	if (!/^[a-f0-9]{64}$/i.test(options.sha256)) {
		throw new Error('Remote server manifest requires a sha256 hex digest');
	}

	return {
		schemaVersion: 1,
		commit: options.commit,
		platform: options.platform,
		artifact: {
			name: options.tarballName,
			sha256: options.sha256.toLowerCase(),
			size: options.size
		},
		compatibility: {
			minGlibc: options.compatibility?.minGlibc ?? null,
			nodeSource: options.compatibility?.nodeSource ?? 'code-oss',
			nativeSource: options.compatibility?.nativeSource ?? null
		},
		createdAt: new Date().toISOString()
	};
}

function packageRemoteServer(options) {
	const sourceDir = validateRemoteServerTree(options.sourceDir).serverDir;
	const commit = options.commit;
	const platform = options.platform ?? 'linux-x64';
	const releaseDir = path.resolve(options.releaseDir ?? path.join(process.cwd(), 'remote-releases', commit));
	const tarballName = options.tarballName ?? `vscode-reh-${platform}.tar.gz`;
	const tarballPath = path.join(releaseDir, tarballName);
	const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'remote-ai-server-package-'));
	const packagedRoot = path.join(tempRoot, 'vscode-reh-linux-x64');

	fs.mkdirSync(releaseDir, { recursive: true });
	fs.cpSync(sourceDir, packagedRoot, { recursive: true, dereference: false });

	if (options.compatNodePath) {
		fs.copyFileSync(path.resolve(options.compatNodePath), path.join(packagedRoot, 'node'));
		fs.chmodSync(path.join(packagedRoot, 'node'), 0o755);
	}
	if (options.compatServerSourceDir) {
		overlayCompatServerArtifacts(packagedRoot, path.resolve(options.compatServerSourceDir));
	}

	for (const extensionPath of options.includeExtensions ?? []) {
		const sourceExtension = path.resolve(extensionPath);
		const targetExtension = path.join(packagedRoot, 'extensions', path.basename(sourceExtension));
		fs.rmSync(targetExtension, { recursive: true, force: true });
		fs.mkdirSync(path.dirname(targetExtension), { recursive: true });
		fs.cpSync(sourceExtension, targetExtension, {
			recursive: true,
			filter: source => !source.includes(`${path.sep}node_modules${path.sep}`) && !source.endsWith(`${path.sep}node_modules`)
		});
	}

	fs.chmodSync(path.join(packagedRoot, 'bin', 'remote-ai-server'), 0o755);
	execFileSync('tar', ['-czf', tarballPath, '-C', tempRoot, 'vscode-reh-linux-x64'], {
		stdio: 'inherit',
		env: { ...process.env, COPYFILE_DISABLE: '1' }
	});

	const buffer = fs.readFileSync(tarballPath);
	const sha256 = crypto.createHash('sha256').update(buffer).digest('hex');
	const manifest = createRemoteServerManifest({
		commit,
		platform,
		tarballName,
		sha256,
		size: buffer.byteLength,
		compatibility: {
			minGlibc: options.minGlibc,
			nodeSource: options.compatNodePath ? path.basename(path.resolve(options.compatNodePath)) : options.compatServerSourceDir ? 'compat-server-source' : 'code-oss',
			nativeSource: options.compatServerSourceDir ? path.basename(path.resolve(options.compatServerSourceDir)) : null
		}
	});
	const manifestPath = path.join(releaseDir, 'manifest.json');
	fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, '\t')}\n`);

	return {
		tarballPath,
		manifestPath,
		manifest
	};
}

function overlayCompatServerArtifacts(packagedRoot, compatServerSourceDir) {
	if (!fs.existsSync(compatServerSourceDir)) {
		throw new Error(`Compatibility server source does not exist: ${compatServerSourceDir}`);
	}

	const compatNode = path.join(compatServerSourceDir, 'node');
	if (fs.existsSync(compatNode)) {
		fs.copyFileSync(compatNode, path.join(packagedRoot, 'node'));
		fs.chmodSync(path.join(packagedRoot, 'node'), 0o755);
	}

	const compatNodeModules = path.join(compatServerSourceDir, 'node_modules');
	if (!fs.existsSync(compatNodeModules)) {
		return;
	}

	for (const sourceNativeModule of findFilesByExtension(compatNodeModules, '.node')) {
		const relativePath = path.relative(compatServerSourceDir, sourceNativeModule);
		const targetNativeModule = path.join(packagedRoot, relativePath);
		fs.mkdirSync(path.dirname(targetNativeModule), { recursive: true });
		fs.copyFileSync(sourceNativeModule, targetNativeModule);
	}
}

function findFilesByExtension(root, extension) {
	const results = [];
	const entries = fs.readdirSync(root, { withFileTypes: true });
	for (const entry of entries) {
		const fullPath = path.join(root, entry.name);
		if (entry.isDirectory()) {
			results.push(...findFilesByExtension(fullPath, extension));
		} else if (entry.isFile() && entry.name.endsWith(extension)) {
			results.push(fullPath);
		}
	}
	return results;
}

function parseArgs(argv) {
	const options = {};
	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i];
		const next = () => {
			if (i + 1 >= argv.length) {
				throw new Error(`Missing value for ${arg}`);
			}
			return argv[++i];
		};
		if (arg === '--source') {
			options.sourceDir = next();
		} else if (arg === '--commit') {
			options.commit = next();
		} else if (arg === '--platform') {
			options.platform = next();
		} else if (arg === '--release-dir') {
			options.releaseDir = next();
		} else if (arg === '--compat-node') {
			options.compatNodePath = next();
		} else if (arg === '--compat-server-source') {
			options.compatServerSourceDir = next();
		} else if (arg === '--min-glibc') {
			options.minGlibc = next();
		} else if (arg === '--include-extension') {
			options.includeExtensions ??= [];
			options.includeExtensions.push(next());
		} else {
			throw new Error(`Unknown argument: ${arg}`);
		}
	}
	if (!options.sourceDir) {
		throw new Error('Missing --source');
	}
	if (!options.commit) {
		throw new Error('Missing --commit');
	}
	return options;
}

if (require.main === module) {
	try {
		const result = packageRemoteServer(parseArgs(process.argv.slice(2)));
		process.stdout.write(`${JSON.stringify(result.manifest, null, '\t')}\n`);
	} catch (error) {
		process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
		process.exitCode = 1;
	}
}

module.exports = {
	createRemoteServerManifest,
	packageRemoteServer,
	overlayCompatServerArtifacts,
	validateRemoteServerTree
};
