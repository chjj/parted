// easy way to get an example of what a particular
// browsers multipart request might look like

require('http').createServer(function(req, res) {
  if (req.method === 'GET') {
    res.statusCode = 200;
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.end([
      '<!doctype html>',
      '<title>multi</title>',
      '<style>form > * { display: block; }</style>',
      '<form action="/" method="POST" enctype="multipart/form-data">',
      '  <input type="text" name="text" value="hello">',
      '  <input type="file" name="content">',
      '  <textarea name="hello">oh look the end of the part:\r\n--</textarea>',
      '  <input type="submit" value="go">',
      '</form>'
    ].join('\n'));
  } else {
    res.statusCode = 200;
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    req.pipe(require('fs').createWriteStream(__dirname + '/test.txt'));
    // display everything to the browser
    Object.keys(req.headers).forEach(function(key) {
      res.write(
        key.replace(/^\w|-\w/g, function(s) { return s.toUpperCase(); })
        + ': ' + req.headers[key] + '\r\n'
      );
    });
    res.write('\r\n');
    req.pipe(res);
  }
}).listen(8080);
