# parted

Parted is a streaming multipart, json, and urlencoded parser for node.js,
written from scratch. It comes bundled with an express middleware which
will use the necessary parser depending on the request mime type. Each parser
is also lazily loaded, so there is no unnecessary memory usage if you only need
one of them.

The middleware will leave you with a `req.body` object, similar to the default
body parser included in express. If a file was included with a multipart
request, a temporary path to the uploaded file is provided in `req.body`.

## Install

``` bash
$ npm install parted
```

## As a middleware

``` js
var parted = require('parted');

app.use(parted({
  path: __dirname + '/uploads', // custom file path
  encodedLimit: 30 * 1024,
  jsonLimit: 30 * 1024,
  mutlipartLimit: 30 * 1024 * 1024
}));
```

## Usage

### The multipart parser alone

``` js
var parted = require('parted');

var parser = new parted.multipart(type, options)
  , parts = {};

parser.on('error', function(err) {
  req.destroy();
  next(err);
});

parser.on('part', function(field, part) {
  // temporary path or string
  parts[field] = part;
});

parser.on('data', function(bytes) {
  console.log('%d bytes written.', this.written);
});

parser.on('end', function() {
  console.log(parts);
});

req.pipe(parser);
```
