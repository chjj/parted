/**
 * Crude Interactive Testing
 */

var express = require('express')
  , parted = require('parted')
  , util = require('util')
  , path = require('path')
  , fs = require('fs');

var app = express.createServer();

var handle = parted({ path: __dirname + '/', stream: true });

/*app.use('/json', function(req, res, next) {
  handle(req, res, function(err) {
    if (err) return next(err);
    var data = req.body.json.split('');
    delete req.body;
    req.headers['content-type'] = 'application/json';
    process.nextTick(function() {
      for (var i = 0, l = data.length; i < l; i++) {
        req.emit('data', new Buffer(data[i], 'utf8'));
      }
      req.emit('end');
    });
    next();
  });
});*/

app.use(handle);

app.use(express.static(__dirname));

app.use(function(req, res, next) {
  if (req.method === 'POST') return next();
  res.end([
    '<!doctype html>',
    '<style>form * { display: block; }</style>',
    '<h1>multipart</h1>',
    '<form action="/" method="POST" enctype="multipart/form-data">',
    '  <input type="text" name="text">',
    '  <input type="file" name="file">',
    '  <input type="submit" name="multipart">',
    '</form>',
    '<h1>form-urlencoded</h1>',
    '<form action="/" method="POST"',
    '  enctype="application/x-www-form-urlencoded">',
    '  <input type="text" name="one">',
    '  <input type="submit" name="two">',
    '</form>',
    '<h1>JSON</h1>',
    '<form action="/json" method="POST" ',
    '  enctype="application/x-www-form-urlencoded">',
    '  <textarea name="json">{}</textarea>',
    '  <input type="button" value="send" id="json">',
    '</form>',
    '<pre id="out"></pre>',
    '<script>',
    '' + send + '',
    'document.getElementById("json").onclick = send;',
    '</script>'
  ].join('\n'));
});

app.use(function(req, res, next) {
  if (req.body && req.body.multipart) {
    var file = req.body.file;
    var ext = path.extname(file);
    //res.contentType(ext);
    //fs.createReadStream(file).pipe(res);
    res.contentType('html');
    res.end([
      '<!doctype html>',
      '<p>' + req.body.text + '</p>',
      '<p><img src="' + req.body.file.split('/').pop() + '"></p>'
    ].join('\n'));
  } else {
    res.contentType('.txt');
    res.end(util.inspect(req.body));
  }
});

app.listen(8080);

function send() {
  var textarea = document.getElementsByTagName('textarea')[0];

  var xhr = new XMLHttpRequest();
  xhr.open('POST', 'http://127.0.0.1:8080/', true);
  xhr.setRequestHeader('Content-Type', 'application/json');

  xhr.onreadystatechange = function() {
    if (xhr.readyState == 4
        && xhr.status === 200) {
      document.getElementById('out').textContent = xhr.responseText;
    }
  };

  xhr.send(textarea.value);
}
