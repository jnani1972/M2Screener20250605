const http = require("node:http");
var options = {
    host: url,
    port: 80,
    path: '/resource?id=foo&bar=baz',
    method: 'POST'
};

exports.get = function (){
    return new Promise((resolve, reject) => {
        http.request(options, function(res) {
            let data = [];
            const headerDate = res.headers && res.headers.date ? res.headers.date : 'no response date';
            console.log('Status Code:', res.statusCode);
            console.log('Date in Response header:', headerDate);

            res.on('data', chunk => {
                data.push(chunk);
            });

            res.on('end', () => {
                console.log('Response ended: ');
                const users = JSON.parse(Buffer.concat(data).toString());

                for(user of users) {
                    console.log(`Got user with id: ${user.id}, name: ${user.name}`);
                }
            }).on('error', err => {
                    reject(err.message)
                });
        }).end();
    })

}

