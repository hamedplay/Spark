import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { JalaliCalendarPicker } from '../../src/components/Tasks/JalaliCalendarPicker';

test('opening reminder picker preserves a non-quarter-hour minute',()=>{
  const markup=renderToStaticMarkup(React.createElement(JalaliCalendarPicker,{
    value:new Date(2026,8,27,16,7),onChange:()=>{},onClose:()=>{},
  }));
  assert.match(markup,/<option value="7" selected="">۰۷<\/option>/);
});
