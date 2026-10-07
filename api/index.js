'use strict';
// Vercel serverless entry point. Every page request is routed here (see vercel.json).
const { handler } = require('../lib/app');

module.exports = handler;
