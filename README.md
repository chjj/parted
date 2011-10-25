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

(__NOTE:__ Limit options have been slightly changed for v0.0.6. Refer to the
example below.)

``` js
var parted = require('parted');

app.use(parted({
  // custom file path
  path: __dirname + '/uploads',
  // memory usage limit per request
  limit: 30 * 1024,
  // disk usage limit per request
  diskLimit: 30 * 1024 * 1024,
  // allow multiple parts of the same name,
  // then available as an array
  multiple: true
}));
```

When `multiple` is disabled only a single part will be present
for a given name, for example:

```js
{ image: '/tmp/bigred.1319577761529.png' }
```

However when `multiple` is enabled, this _may_ be an array:

```js
{ images: 
   [ '/tmp/bigred-pau.1319577761529.png',
     '/tmp/bigred-ico.1319577761528.png',
     '/tmp/bigred-rec.1319577761529.png',
     '/tmp/bigred-sto.1319577761529.png',
     '/tmp/bigred.1319577761529.png' ] }
```

## Usage

### The multipart parser alone

``` js
var multipart = require('parted').multipart;

var options = {
  limit: 30 * 1024,
  diskLimit: 30 * 1024 * 1024
};

var parser = new multipart(type, options)
  , parts = {};

parser.on('error', function(err) {
  req.destroy();
  next(err);
});

parser.on('part', function(field, part) {
  // temporary path or string
  parts[field] = part;
});

parser.on('data', function() {
  console.log('%d bytes written.', this.written);
});

parser.on('end', function() {
  console.log(parts);
});

req.pipe(parser);
```

## Running tests

  $ node test

