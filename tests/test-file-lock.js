/**
 * test-file-lock.js - File lock + concurrent writes (async)
 *
 * Tests: fileLockModule
 */

const { existsSync, readFileSync, writeFileSync, utimesSync } = require('fs');
const { join } = require('path');
const { spawn } = require('child_process');
const {
  LIB_PATH, TEMP_DIR,
  log, logVerbose, test, testAsync,
  assert, assertEqual,
  lib
} = require('./test-utils');

async function run() {
  const { fileLock } = lib();

  log('\n=== file-lock.js Module ===');

  test('atomicWriteJson writes and reads back', () => {
    const testFile = join(TEMP_DIR, 'atomic-test.json');
    const data = { key: 'value', num: 42 };

    fileLock.atomicWriteJson(testFile, data);

    assert(existsSync(testFile), 'File should exist after atomic write');
    const read = JSON.parse(readFileSync(testFile, 'utf8'));
    assertEqual(read.key, 'value', 'Key should match');
    assertEqual(read.num, 42, 'Num should match');
    assert(!existsSync(testFile + '.tmp'), 'Temp file should be cleaned up');
  });

  test('withLockedFile creates file if missing', () => {
    const testFile = join(TEMP_DIR, 'locked-create.json');

    fileLock.withLockedFile(testFile, (data) => {
      data.created = true;
    });

    assert(existsSync(testFile), 'File should be created');
    const read = JSON.parse(readFileSync(testFile, 'utf8'));
    assertEqual(read.created, true, 'Data should be written');
    assert(!existsSync(testFile + '.lock'), 'Lock file should be cleaned up');
  });

  test('withLockedFile does read-modify-write correctly', () => {
    const testFile = join(TEMP_DIR, 'locked-rmw.json');

    fileLock.atomicWriteJson(testFile, { count: 0 });

    fileLock.withLockedFile(testFile, (data) => {
      data.count = data.count + 1;
      data.extra = 'added';
    });

    const read = JSON.parse(readFileSync(testFile, 'utf8'));
    assertEqual(read.count, 1, 'Count should be incremented');
    assertEqual(read.extra, 'added', 'Extra field should be added');
  });

  test('acquireLock/releaseLock manual cycle', () => {
    const testFile = join(TEMP_DIR, 'manual-lock.json');

    fileLock.acquireLock(testFile);
    assert(existsSync(testFile + '.lock'), 'Lock file should exist while held');

    fileLock.releaseLock(testFile);
    assert(!existsSync(testFile + '.lock'), 'Lock file should be removed after release');
  });

  test('Stale lock recovery', () => {
    const testFile = join(TEMP_DIR, 'stale-lock.json');
    const lockFile = testFile + '.lock';

    writeFileSync(lockFile, '99999', { flag: 'w' });
    const past = new Date(Date.now() - 60000);
    utimesSync(lockFile, past, past);

    fileLock.withLockedFile(testFile, (data) => {
      data.recovered = true;
    });

    const read = JSON.parse(readFileSync(testFile, 'utf8'));
    assertEqual(read.recovered, true, 'Should recover from stale lock');
    assert(!existsSync(lockFile), 'Lock file should be cleaned up');
  });

  await testAsync('Concurrent write test (5 parallel processes)', async () => {
    const testFile = join(TEMP_DIR, 'concurrent-test.json');

    fileLock.atomicWriteJson(testFile, {});

    const fileLockPath = join(LIB_PATH, 'file-lock.js').replace(/\\/g, '\\\\');
    const testFilePath = testFile.replace(/\\/g, '\\\\');

    const promises = [];
    for (let i = 0; i < 5; i++) {
      promises.push(new Promise((resolve, reject) => {
        const child = spawn('node', ['-e', `
          const { withLockedFile } = require("${fileLockPath}");
          withLockedFile("${testFilePath}", (data) => {
            data["worker_${i}"] = { pid: process.pid, time: Date.now() };
          });
          process.exit(0);
        `], { windowsHide: true, stdio: 'pipe' });

        let stderr = '';
        child.stderr.on('data', d => { stderr += d; });
        child.on('close', (code) => {
          if (code === 0) resolve();
          else reject(new Error(`Worker ${i} exited with code ${code}: ${stderr}`));
        });
        child.on('error', reject);
      }));
    }

    await Promise.all(promises);

    const result = JSON.parse(readFileSync(testFile, 'utf8'));
    for (let i = 0; i < 5; i++) {
      assert(result[`worker_${i}`], `worker_${i} key should be present`);
      assert(result[`worker_${i}`].pid, `worker_${i} should have pid`);
    }

    logVerbose(`All 5 worker entries present: ${Object.keys(result).join(', ')}`);
  });
}

module.exports = { run };
