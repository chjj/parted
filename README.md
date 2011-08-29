# parted

Parted is a streaming multipart parser.

## Usage

``` js
var parted = require('parted');

var parser = new parted(type, options)
  , parts = {};

parser.on('error', function(err) {
  req.destroy();
  next(err);
});

parser.on('data', function(part) {
  parts[part.field] = part.file || part.text;
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
