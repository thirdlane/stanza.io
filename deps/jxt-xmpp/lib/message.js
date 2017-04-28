'use strict';

Object.defineProperty(exports, '__esModule', {
    value: true
});

var _xmppConstants = require('xmpp-constants');

var internals = {};

internals.defineMessage = function (JXT, name, namespace) {

    var Utils = JXT.utils;

    JXT.define({
        name: name,
        namespace: namespace,
        element: 'message',
        topLevel: true,
        fields: {
            lang: Utils.langAttribute(),
            id: Utils.attribute('id'),
            to: Utils.jidAttribute('to', true),
            from: Utils.jidAttribute('from', true),
            type: Utils.attribute('type', 'normal'),
            thread: Utils.textSub(namespace, 'thread'),
            parentThread: Utils.subAttribute(namespace, 'thread', 'parent'),
            subject: Utils.textSub(namespace, 'subject'),
            $body: {
                get: function getBody$() {

                    return Utils.getSubLangText(this.xml, namespace, 'body', this.lang);
                }
            },
            body: {
                get: function getBody() {

                    var bodies = this.$body;
                    return bodies[this.lang] || '';
                },
                set: function setBody(value) {

                    Utils.setSubLangText(this.xml, namespace, 'body', value, this.lang);
                }
            },
            attention: Utils.boolSub(_xmppConstants.Namespace.ATTENTION_0, 'attention'),
            chatState: Utils.enumSub(_xmppConstants.Namespace.CHAT_STATES, ['active', 'composing', 'paused', 'inactive', 'gone']),
            replace: Utils.subAttribute(_xmppConstants.Namespace.CORRECTION_0, 'replace', 'id'),
            requestReceipt: Utils.boolSub(_xmppConstants.Namespace.RECEIPTS, 'request'),
            receipt: Utils.subAttribute(_xmppConstants.Namespace.RECEIPTS, 'received', 'id')
        }
    });
};

exports['default'] = function (JXT) {

    internals.defineMessage(JXT, 'message', _xmppConstants.Namespace.CLIENT);
    internals.defineMessage(JXT, 'serverMessage', _xmppConstants.Namespace.SERVER);
    internals.defineMessage(JXT, 'componentMessage', _xmppConstants.Namespace.COMPONENT);
};

module.exports = exports['default'];
//# sourceMappingURL=message.js.map