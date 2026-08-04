#!/bin/sh
export VITEST_BROWSER_CHANNEL=chrome
npx vitest run --config vitest.browser.config.js
