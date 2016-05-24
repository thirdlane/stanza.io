module.exports = function(client, stanzas){

    var Utils = stanzas.utils;

    var RoomRoster = stanzas.define({
        name: 'roomsRoster',
        element: 'query',
        namespace: 'xmpp:prosody.im:muc-membership',
        fields: {
            room: Utils.attribute('room')
        }
    });

    var Room = stanzas.define({
        name: '_roomItem',
        namespace: 'xmpp:prosody.im:muc-membership',
        element: 'room',
        fields: {
            jid: Utils.jidAttribute('jid'),
            name: Utils.attribute('name'),
            subject: Utils.attribute('subject'),
            description: Utils.attribute('description'),
            image_url: Utils.attribute('image_url'),
            public: Utils.boolAttribute('public')
        }
    });

    var Member = stanzas.define({
        name: '_memberItem',
        namespace: 'xmpp:prosody.im:muc-membership',
        element: 'member',
        fields: {
            jid: Utils.jidAttribute('jid'),
            affiliation: Utils.attribute('affiliation'),
            online: Utils.boolAttribute('online')
        }
    });

    var PublicRoomList = stanzas.define({
        name: 'publicRoomList',
        element: 'query',
        namespace: 'xmpp:prosody.im:muc-publicrooms',
        fields: {
            room: Utils.attribute('room')
        }
    });

    var PublicRoom = stanzas.define({
        name: '_roomItem',
        namespace: 'xmpp:prosody.im:muc-publicrooms',
        element: 'room',
        fields: {
            jid: Utils.jidAttribute('jid'),
            name: Utils.attribute('name'),
            subject: Utils.attribute('subject'),
            description: Utils.attribute('description'),
            affiliation: Utils.attribute('affiliation'),
            image_url: Utils.attribute('image_url'),
            public: Utils.boolAttribute('public')
        }
    });

    var PublicMember = stanzas.define({
        name: '_memberItem',
        namespace: 'xmpp:prosody.im:muc-publicrooms',
        element: 'member',
        fields: {
            jid: Utils.jidAttribute('jid'),
            affiliation: Utils.attribute('affiliation'),
            online: Utils.boolAttribute('online')
        }
    });


    var UniqueName = stanzas.define({
        name: 'uniqueName',
        element: 'query',
        namespace: 'xmpp:prosody.im:muc-uniquename',
        fields: {
            name: Utils.attribute('name')
        }
    });

    var Uniserver = stanzas.define({
        name: 'uniserver',
        element: 'query',
        namespace: 'xmpp:thirdlane:uniserver',
        fields: {
            command: Utils.textSub('xmpp:thirdlane:uniserver', 'command')
        }
    });

    client.sendUniserverAction = function(command, to, cb){
        return this.sendIq({
            to: to,
            type: 'set',
            uniserver: {
                command: command
            }
        }, cb);
    };



    client.checkUniqueName = function (name, to, cb) {
        return this.sendIq({
            to: to,
            type: 'get',
            uniqueName: {
                name: name
            }
        }, cb);
    };

    client.getRoom = function (to, room, cb) {
        return this.sendIq({
            to: to,
            type: 'get',
            roomsRoster: {
                room: room
            }
        }, cb);
    };

    stanzas.extendIQ(UniqueName);



    stanzas.extend(Room, Member, 'members');

    stanzas.extend(RoomRoster, Room, 'rooms');

    stanzas.extendIQ(RoomRoster);

    stanzas.extendIQ(Uniserver);


    stanzas.extend(PublicRoom, PublicMember, 'members');

    stanzas.extend(PublicRoomList, PublicRoom, 'rooms');

    stanzas.extendIQ(PublicRoomList);

    client.getMyRooms = function (to, cb) {
        return this.sendIq({
            to: to,
            type: 'get',
            roomsRoster: true
        }, cb);
    };

    client.getPublicRooms = function (to, cb) {
        return this.sendIq({
            to: to,
            type: 'get',
            publicRoomList: true
        }, cb);
    };


    var RoomCreate = stanzas.define({
        name: 'roomCreate',
        element: 'query',
        namespace: 'xmpp:thirdlane:muc_admin',
        fields: {
            room: Utils.attribute('room'),
            members: {
                set: function(values){
                    var self = this;
                    var members = stanzas.utils.createElement('xmpp:thirdlane:muc_admin', 'members', 'xmpp:thirdlane:muc_admin');
                    values.forEach(function (value) {
                        var member = stanzas.utils.createElement('xmpp:thirdlane:muc_admin', 'member', 'xmpp:thirdlane:muc_admin');
                        stanzas.utils.setAttribute(member, 'jid', value.jid.toString());
                        stanzas.utils.setAttribute(member, 'affiliation', value.affiliation.toString());
                        members.appendChild(member);
                    });
                    self.xml.appendChild(members)
                }
            }
        }
    });


    client.disco.addFeature('urn:xmpp:browserwhois');

    var whoIs = stanzas.define({
        name: 'browserwhois',
        element: 'browserwhois',
        namespace: 'urn:xmpp:browserwhois',
        fields: {
            initiator_ua: Utils.attribute('initiator_ua'),
            responder_ua: Utils.attribute('responder_ua')
        }
    });

    client.on('iq:get:browserwhois', function (iq) {
        var browser = !navigator.mozGetUserMedia ? 'chrome':'firefox';
        client.sendIq(iq.resultReply({
            browserwhois:{
                initiator_ua: iq.browserwhois.initiator_ua,
                responder_ua: browser
            }
        }));
    });

    client.getBrowser = function(to, cb){
        var browser = !navigator.mozGetUserMedia ? 'chrome':'firefox';
        return client.sendIq({
            to: to,
            type: 'get',
            browserwhois:{
                initiator_ua: browser
            }
        },cb)
    };

    stanzas.extendIQ(whoIs);

    /*var RoomCreateMember = stanzas.define({
        name: '_memberItem',
        namespace: 'xmpp:thirdlane:muc_admin',
        element: 'member',
        fields: {
            jid: Utils.jidAttribute('jid'),
            affiliation: Utils.attribute('affiliation')
        }
    });*/

    //stanzas.extend(RoomCreate, RoomCreateMember, 'members');


    stanzas.withDataForm(function (DataForm) {
        stanzas.extend(RoomCreate, DataForm);
    });

    stanzas.extendIQ(RoomCreate);

    client.createRoom = function (to, config, cb) {
        return this.sendIq({
            to: to,
            type: 'set',
            roomCreate: {
                room: config.room,
                form: config.form,
                members: config.members
            }
        }, cb);
    };

    stanzas.withMessage(function(MESSAGE){
        stanzas.add(MESSAGE, 'subtype', Utils.attribute('subtype'));
        stanzas.add(MESSAGE, 'body_type', Utils.attribute('body_type'));
        stanzas.add(MESSAGE, 'remove', Utils.subAttribute('urn:xmpp:message-delete:0', 'remove', 'id'));
    });
};