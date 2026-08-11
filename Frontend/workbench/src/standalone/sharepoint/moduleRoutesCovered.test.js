// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { globSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { createSharePointAdapter } from './axiosSharePointAdapter';

// ---------------------------------------------------------------------------
// Every endpoint the module calls must have a SharePoint route behind it.
// ---------------------------------------------------------------------------
// The uncertainty module is shared verbatim between the Django/Electron
// workbench and the SharePoint build; the only thing standing between them is
// the axios adapter's route table. Add a feature that calls a new endpoint and
// forget the matching route, and the failure is invisible where it is written:
// on a developer's desk Django answers, and the tool works. It breaks only on
// Flank Speed, only in that one feature, and only once someone tries it.
//
// So the two are checked against each other. Call sites are read out of the
// source, and each is put through the *real* adapter — not a copy of its route
// list, which could itself drift.
//
// Scope: this proves a route exists for the shape of a call. Whether the
// handler behind it is correct is axiosSharePointAdapter.test.js's job.

const SRC = path.resolve(import.meta.dirname, '../..');
const API_ROOT = 'https://tenant.example/api/uncertainty';

/** `axios.<method>(`<template>`` — the method may sit a line above the URL. */
const AXIOS_CALL = /\baxios\s*\.\s*(get|post|put|patch|delete|head|options)\s*\(\s*`([^`]*)`/g;

/**
 * Every uncertainty endpoint the app asks for, as a concrete method and URL.
 *
 * Interpolations become `1`, which satisfies both the numeric ids the session
 * routes match and the opaque ids the record routes match — enough to ask
 * whether a route exists at all.
 */
function discoverCalls() {
  const files = globSync('**/*.{js,jsx}', { cwd: SRC })
    // The adapter and its neighbours are the other side of this contract.
    .filter((f) => !f.startsWith('standalone') && !/\.test\.[jt]sx?$/.test(f))
    .sort();

  const calls = [];
  for (const file of files) {
    const source = readFileSync(path.join(SRC, file), 'utf8');
    for (const [, method, template] of source.matchAll(AXIOS_CALL)) {
      if (!template.startsWith('${UNCERTAINTY_API}')) continue;
      const endpoint = template
        .replace('${UNCERTAINTY_API}', '')
        .replace(/\$\{[^}]*\}/g, '1');
      calls.push({ method: method.toUpperCase(), endpoint, file, template });
    }
  }
  return calls;
}

/**
 * The real adapter, wired to a store that answers everything blandly.
 *
 * A handler that throws is fine here — that is a handler bug, not a missing
 * route, and it has its own tests. Only "no route matched" is a failure, which
 * the adapter signals with a 501 and a fallthrough to the network for anything
 * outside the API root.
 */
function routeProbe() {
  const store = new Proxy({}, { get: () => async () => [] });
  let fellThrough = false;

  const adapter = createSharePointAdapter({
    store,
    apiRoot: API_ROOT,
    fallback: async () => {
      fellThrough = true;
      return { data: null, status: 200, statusText: 'OK', headers: {}, config: {} };
    },
  });

  return async ({ method, endpoint }) => {
    fellThrough = false;
    let unrouted = false;
    try {
      await adapter({ method: method.toLowerCase(), url: `${API_ROOT}${endpoint}` });
    } catch (error) {
      unrouted = error.response?.status === 501 || /No SharePoint handler/.test(error.message);
    }
    return { routed: !unrouted && !fellThrough, fellThrough };
  };
}

const calls = discoverCalls();

describe('the module\'s API calls', () => {
  it('were actually found by the scanner', () => {
    // A regex that quietly matches nothing would make every assertion below
    // vacuous, so the scan has to prove it saw the traffic it is checking.
    expect(calls.length).toBeGreaterThanOrEqual(15);
    expect(new Set(calls.map((c) => c.method))).toContain('DELETE');
    expect(calls.some((c) => c.endpoint.includes('/sessions/'))).toBe(true);
  });

  it('picks up a URL written on the line after the method', () => {
    // Four call sites are wrapped that way; a line-based scan would miss them.
    expect(calls.some((c) => c.endpoint === '/sessions/1/images/1/')).toBe(true);
  });

  it.each(calls.map((c) => [`${c.method} ${c.endpoint}`, c]))(
    'has a SharePoint route for %s',
    async (_label, call) => {
      const { routed } = await routeProbe()(call);
      expect(routed, `${call.method} ${call.endpoint} (${call.file}) has no route in `
        + 'axiosSharePointAdapter.js, so it will fail in the SharePoint build').toBe(true);
    },
  );
});

describe('the probe itself', () => {
  it('reports an endpoint with no route as unrouted', async () => {
    // Negative control: without this, a probe that always said "routed" would
    // make the whole file pass while proving nothing.
    const { routed } = await routeProbe()({ method: 'GET', endpoint: '/not_a_real_endpoint/' });
    expect(routed).toBe(false);
  });

  it('reports a wrong method on a real path as unrouted', async () => {
    const { routed } = await routeProbe()({ method: 'PATCH', endpoint: '/instruments/' });
    expect(routed).toBe(false);
  });

  it('does not mistake a handler error for a missing route', async () => {
    // getSession on the bland store returns [], which patchNotes will choke on.
    // The route is still there, and that is what is being asserted.
    const probe = routeProbe();
    const { routed } = await probe({ method: 'PATCH', endpoint: '/sessions/1/notes/' });
    expect(routed).toBe(true);
  });

  it('counts a call outside the API root as not routed', async () => {
    const store = new Proxy({}, { get: () => async () => [] });
    let fellThrough = false;
    const adapter = createSharePointAdapter({
      store,
      apiRoot: API_ROOT,
      fallback: async () => { fellThrough = true; return { data: null, status: 200, headers: {}, config: {} }; },
    });
    await adapter({ method: 'get', url: 'https://tenant.example/api/other/thing/' });
    expect(fellThrough).toBe(true);
  });
});
