# a streaming multipart parser

Just wanted to get this up. It's still yet to be optimized. It's streaming 
and only buffers 4 bytes.

    var parted = require('parted');
    parted(req, function(parts) {
      console.log(parts);
    });
    
    // or 
    
    req.pipe(new parted().on('data', ...etc));
    
If the field was a file, a temporary file path will be returned.