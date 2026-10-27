import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';
import react from '@vitejs/plugin-react';

test('drag selection shows inclusive slot duration and time range in either direction', async () => {
  const server = await createServer({ configFile: false, server: { middlewareMode: true }, appType: 'custom', plugins: [react()] });
  try {
    const { DragSelectionLabel } = await server.ssrLoadModule('/src/components/Calendar/DragSelectionLabel.tsx');
    const render = (startSlot: number, endSlot: number) => renderToStaticMarkup(React.createElement(DragSelectionLabel, { startSlot, endSlot }));
    assert.match(render(14, 14), /۳۰ دقیقه/);
    assert.match(render(14, 15), /۱ ساعت/);
    const forward = render(14, 16);
    assert.match(forward, /۰۷:۰۰ – ۰۸:۳۰/);
    assert.match(forward, /۱ ساعت و ۳۰ دقیقه/);
    assert.equal(render(16, 14), forward);
    assert.match(render(0, 47), /۲۴:۰۰/);
    assert.match(render(0, 47), /۲۴ ساعت/);
  } finally { await server.close(); }
});
