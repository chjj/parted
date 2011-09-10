# parted

Parted is a streaming multipart parser. It eventually intends to be a completely 
streaming request body parser for URL encoded messages, JSON, along with 
multipart. The QS and JSON parsers are currently included, but they're somewhat
experimental.

## Usage

``` js
var parted = require('parted');

var parser = new parted(type, options)
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

### As a middleware

``` js
var parser = parted.middleware({ 
  path: __dirname + '/uploads' 
});
app.use(parser);
```
