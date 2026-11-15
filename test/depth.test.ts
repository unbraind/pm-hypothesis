import assert from 'node:assert/strict';
import test from 'node:test';
import { testDepth } from './support/depth.ts';
import { testTime } from './support/time.ts';

test('depth defaults to full and watchdogs round up or reject invalid scales', () => {
  const depth = process.env.PM_TEST_DEPTH, scale = process.env.PM_TEST_TIME_SCALE;
  try {
    delete process.env.PM_TEST_DEPTH;
    assert.equal(testDepth(500), 500);
    process.env.PM_TEST_DEPTH = 'quick';
    assert.equal(testDepth(500), 50); assert.equal(testDepth(100), 25);
    assert.equal(testDepth(10), 10);
    process.env.PM_TEST_TIME_SCALE = '1.001'; assert.equal(testTime(1), 2);
    for (const invalid of ['', '0', '-1', 'Infinity', 'NaN', '1e99']) {
      process.env.PM_TEST_TIME_SCALE = invalid;
      assert.throws(() => testTime(10), /PM_TEST_TIME_SCALE/);
    }
  } finally {
    if (depth === undefined) delete process.env.PM_TEST_DEPTH; else process.env.PM_TEST_DEPTH = depth;
    if (scale === undefined) delete process.env.PM_TEST_TIME_SCALE; else process.env.PM_TEST_TIME_SCALE = scale;
  }
});
