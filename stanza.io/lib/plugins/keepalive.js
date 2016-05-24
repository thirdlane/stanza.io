'use strict';
var keepaliveTimeout;


module.exports = function (client) {
    function handleTimeout (){
        // Kill the apparently dead connection without closing
        // the stream itself so we can reconnect and potentially
        // resume the session.
        client.emit('stream:error', {
            condition: 'connection-timeout',
            text: 'Server did not respond'
        });
        client.transport.hasStream = false;
        client.transport.disconnect();
    }

    client.enableKeepAlive = function (opts) {
        opts = opts || {};
        opts.timeout = opts.timeout || 30;
        opts.timeout = opts.timeout * 1000;
        keepaliveTimeout = setTimeout(handleTimeout, opts.timeout);
        client.on('keepalive',function(){
            clearTimeout(keepaliveTimeout);
            keepaliveTimeout = setTimeout(handleTimeout, opts.timeout);
        })
    };

    client.disableKeepAlive = function () {
        clearTimeout(keepaliveTimeout);
    };

    client.on('disconnected', function () {
        client.disableKeepAlive();
    });
};
