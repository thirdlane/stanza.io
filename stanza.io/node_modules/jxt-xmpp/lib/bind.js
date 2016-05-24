'use strict';

Object.defineProperty(exports, '__esModule', {
    value: true
});

var _xmppConstants = require('xmpp-constants');

exports['default'] = function (JXT) {

    var Utils = JXT.utils;

    var Bind = JXT.define({
        name: 'bind',
        namespace: _xmppConstants.Namespace.BIND,
        element: 'bind',
        fields: {
            resource: Utils.textSub(_xmppConstants.Namespace.BIND, 'resource'),
            jid: Utils.jidSub(_xmppConstants.Namespace.BIND, 'jid')
        }
    });

    JXT.extendIQ(Bind);
    JXT.extendStreamFeatures(Bind);
};

module.exports = exports['default'];
//# sourceMappingURL=bind.js.map