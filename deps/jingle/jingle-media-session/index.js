var util = require('util');
var each = require('lodash.foreach');
var extend = require('extend-object');
var BaseSession = require('jingle-session');
var RTCPeerConnection = require('rtcpeerconnection');


function filterContentSources(content, stream) {
    if (content.description.descType !== 'rtp') {
        return;
    }
    delete content.transport;
    delete content.description.payloads;
    delete content.description.headerExtensions;
    content.description.mux = false;

    if (content.description.sources) {
        content.description.sources = content.description.sources.filter(function (source) {
            return stream.id === source.parameters[1].value.split(' ')[0];
        });
    }
    // remove source groups not related to this stream
    if (content.description.sourceGroups) {
        content.description.sourceGroups = content.description.sourceGroups.filter(function (group) {
            var found = false;
            for (var i = 0; i < content.description.sources.length; i++) {
                if (content.description.sources[i].ssrc === group.sources[0]) {
                    found = true;
                    break;
                }
            }
            return found;
        });
    }
}

function filterUnusedLabels(content) {
    // Remove mslabel and label ssrc-specific attributes
    var sources = content.description.sources || [];
    sources.forEach(function (source) {
        source.parameters = source.parameters.filter(function (parameter) {
            return !(parameter.key === 'mslabel' || parameter.key === 'label');
        });
    });
}


function MediaSession(opts) {
    BaseSession.call(this, opts);

    this.pc = new RTCPeerConnection({
        iceServers: opts.iceServers || [],
        useJingle: true,
        rtcpMuxPolicy: 'require',
        iceTransportPolicy: opts.iceTransportPolicy || 'all'
    }, opts.constraints || {});

    this.pc.on('ice', this.onIceCandidate.bind(this));
    this.pc.on('endOfCandidates', this.onIceEndOfCandidates.bind(this));
    this.pc.on('iceConnectionStateChange', this.onIceStateChange.bind(this));
    this.pc.on('addStream', this.onAddStream.bind(this));
    this.pc.on('removeStream', this.onRemoveStream.bind(this));
    this.pc.on('addChannel', this.onAddChannel.bind(this));
    this.pc.on('negotiationNeeded', this.onNegotiationNeeded.bind(this));

    if (opts.stream) {
        this.addStream(opts.stream);
    }

    this._ringing = false;
}




util.inherits(MediaSession, BaseSession);


Object.defineProperties(MediaSession.prototype, {
    ringing: {
        get: function () {
            return this._ringing;
        },
        set: function (value) {
            if (value !== this._ringing) {
                this._ringing = value;
                this.emit('change:ringing', value);
            }
        }
    },
    streams: {
        get: function () {
            if (this.pc.signalingState !== 'closed') {
                return this.pc.getRemoteStreams();
            }
            return [];
        }
    }
});


MediaSession.prototype = extend(MediaSession.prototype, {

    // ----------------------------------------------------------------
    // Session control methods
    // ----------------------------------------------------------------

    start: function (offerOptions, next, opts) {
        var self = this;
        this.state = 'pending';

        next = next || function () {};

        if(offerOptions && offerOptions.calleeBrowser){
            this.pc.calleeBrowser = offerOptions.calleeBrowser
        }

        this.pc.isInitiator = true;
        this.pc.offer(offerOptions, function (err, offer) {
            if (err) {
                self._log('error', 'Could not create WebRTC offer', err);
                return self.end('failed-application', true);
            }

            // a workaround for missing a=sendonly
            // https://code.google.com/p/webrtc/issues/detail?id=1553
            if (offerOptions && offerOptions.mandatory) {
                offer.jingle.contents.forEach(function (content) {
                    var mediaType = content.description.media;

                    if (!content.description || content.description.descType !== 'rtp') {
                        return;
                    }

                    if (!offerOptions.mandatory.OfferToReceiveAudio && mediaType === 'audio') {
                        content.senders = 'initiator';
                    }

                    if (!offerOptions.mandatory.OfferToReceiveVideo && mediaType === 'video') {
                        content.senders = 'initiator';
                    }
                });
            }

            offer.jingle.contents.forEach(filterUnusedLabels);
            if(opts && opts.members){
                offer.jingle.members = [];
                offer.jingle.members.push({members: opts.members});
            }
            self.send('session-initiate', offer.jingle);

            next();
        });
    },

    accept: function (next) {
        var self = this;

        next = next || function () {};

        this._log('info', 'Accepted incoming session');

        this.state = 'active';

        this.pc.answer(function (err, answer) {
            if (err) {
                self._log('error', 'Could not create WebRTC answer', err);
                return self.end('failed-application');
            }

            answer.jingle.contents.forEach(filterUnusedLabels);

            self.send('session-accept', answer.jingle);

            next();
        });
    },

    accept2: function (answerOptions, cb) {
        var self = this;

        cb = cb || function () {};

        this._log('info', 'Accepted incoming session');

        this.state = 'active';
        if(answerOptions && answerOptions.callerBrowser){
            this.pc.callerBrowser = answerOptions.callerBrowser;
        }


        if (!this.pc.localDescription){
            this.pc.answer(answerOptions, function (err, answer) {
                if (err) {
                    self._log('error', 'Could not create WebRTC answer', err);
                    return self.end('failed-application');
                }

                answer.jingle.contents.forEach(filterUnusedLabels);

                self.send('session-accept', answer.jingle);

                cb();
            });
        } else {
            this.pc.handleOffer({
                    type: 'offer',
                    jingle: self.pc.remoteDescription
                }, function (err) {
                    if (err) {
                        self._log('error', 'Error adding new stream source');
                        return cb({
                            condition: 'general-error'
                        });
                    }

                    self.pc.answer(answerOptions, function (err, answer) {
                        if (err) {
                            self._log('error', 'Could not create WebRTC answer', err);
                            return self.end('failed-application');
                        }

                        answer.jingle.contents.forEach(filterUnusedLabels);

                        self.send('session-accept', answer.jingle);

                        cb();
                    });
                }
            );
        }
    },

    acceptAudioOnly: function (next) {
        var self = this;

        next = next || function () {};

        this._log('info', 'Accepted incoming session');

        this.state = 'active';

        this.pc.answerAudioOnly(function (err, answer) {
            if (err) {
                self._log('error', 'Could not create WebRTC answer', err);
                return self.end('failed-application');
            }

            answer.jingle.contents.forEach(filterUnusedLabels);

            self.send('session-accept', answer.jingle);

            next();
        });
    },


    end: function (reason, silent) {
        var self = this;
        this.streams.forEach(function (stream) {
            self.onRemoveStream({stream: stream});
        });
        this.pc.getLocalStreams().forEach(function (stream) {
            if(navigator.mozGetUserMedia) {
                stream.stop();
            } else {
                stream.getTracks().forEach(function (track) {
                    track.stop();
                });
            }
        });
        this.pc.close();
        BaseSession.prototype.end.call(this, reason, silent);
    },

    ring: function () {
        this._log('info', 'Ringing on incoming session');
        this.ringing = true;
        this.send('session-info', {ringing: true});
    },

    mute: function (creator, name) {
        this._log('info', 'Muting', name);

        this.send('session-info', {
            mute: {
                creator: creator,
                name: name
            }
        });
    },

    unmute: function (creator, name) {
        this._log('info', 'Unmuting', name);
        this.send('session-info', {
            unmute: {
                creator: creator,
                name: name
            }
        });
    },

    hold: function (cb) {
        this._log('info', 'Placing on hold');
        cb = cb || function(){};
        var ua = this.pc.isInitiator ? this.pc.calleeBrowser : this.pc.callerBrowser;
        if (ua == 'jvb'){
            var desc = this.pc.remoteDescription;
            desc.contents.forEach(function (content) {
                content.senders = 'none';
            });
            var self = this;
            this.pc.handleOffer({
                type: 'offer',
                jingle: desc
            }, function (err) {
                if (err) {
                    self._log('error', 'Error removing stream source');
                    return cb({
                        condition: 'general-error'
                    });
                }
                self.pc.answer(function (err, answer) {
                    if (err) {
                        self._log('error', 'Error removing stream source');
                        return cb({
                            condition: 'general-error'
                        });
                    }
                    cb();
                });
            });
        }
        this.send('session-info', {hold: true});
    },

    resume: function (cb) {
        this._log('info', 'Resuming from hold');
        cb = cb || function(){};
        var ua = this.pc.isInitiator ? this.pc.calleeBrowser : this.pc.callerBrowser;
        if (ua == 'jvb'){
            var desc = this.pc.remoteDescription;
            desc.contents.forEach(function (content) {
                content.senders = 'both';
            });
            var self = this;
            this.pc.handleOffer({
                type: 'offer',
                jingle: desc
            }, function (err) {
                if (err) {
                    self._log('error', 'Error removing stream source');
                    return cb({
                        condition: 'general-error'
                    });
                }
                self.pc.answer(function (err, answer) {
                    if (err) {
                        self._log('error', 'Error removing stream source');
                        return cb({
                            condition: 'general-error'
                        });
                    }
                    cb();
                });
            });
        }
        this.send('session-info', {active: true});
    },

    // ----------------------------------------------------------------
    // Stream control methods
    // ----------------------------------------------------------------

    onNegotiationNeeded: function () {
        this.emit('NegotiationNeeded');
    },


    addStream: function (stream, renigotiate, cb) {
        if (!renigotiate){
            this.pc.addStream(stream);
            return
        }
        var ua = this.pc.isInitiator ? this.pc.calleeBrowser : this.pc.callerBrowser;
        if (ua == 'jvb'){
            this.addStream2(stream, cb);
        } else {
            this.addStream3(stream, cb);
        }
    },

    addStream2: function (stream, cb) {
        var self = this;

        cb = cb || function () {};

        this.pc.addStream(stream);

        this.pc.handleOffer({
            type: 'offer',
            jingle: this.pc.remoteDescription
        }, function (err) {
            if (err) {
                self._log('error', 'Could not create offer for adding new stream');
                return cb(err);
            }
            self.pc.answer(function (err, answer) {
                if (err) {
                    self._log('error', 'Could not create answer for adding new stream');
                    return cb(err);
                }

                var response = JSON.parse(JSON.stringify(answer));
                response.jingle.contents.forEach(function (content) {
                    filterContentSources(content, stream);
                });
                response.jingle.contents = response.jingle.contents.filter(function (content) {
                    return content.description.descType === 'rtp' && content.description.sources && content.description.sources.length;
                });
                delete response.jingle.groups;

                self.send('source-add', response.jingle);
                cb();
            });
        });
    },


    addStream3: function (stream, cb) {
        var self = this;

        cb = cb || function () {};

        this.pc.addStream(stream);
        if(navigator.mozGetUserMedia) {
            setTimeout(function(){
                self.emit('NegotiationNeeded');
            },500);
        }
        this.once('NegotiationNeeded',function(){
            var self = this;
            if(navigator.mozGetUserMedia) {
                offerOptions = {
                    offerToReceiveAudio: true,
                    offerToReceiveVideo: true
                };
            } else {
                offerOptions = {};
                offerOptions.mandatory = {};
                offerOptions.mandatory.OfferToReceiveAudio = true;
                offerOptions.mandatory.OfferToReceiveVideo = true;
            }
            self.pc.offer(offerOptions, function (err, offer) {
                if (err) {
                    self._log('error', 'Could not create WebRTC offer', err);
                    return self.end('failed-application', true);
                }
                offer.jingle.contents.forEach(filterUnusedLabels);

                self.send('source-add', offer.jingle);
            });
        });
    },


    removeStream: function (stream, renigotiate, cb) {
        if (!renigotiate){
            this.pc.removeStream(stream);
            return
        }
        var ua = this.pc.isInitiator ? this.pc.calleeBrowser : this.pc.callerBrowser;
        if (ua == 'jvb'){
            this.removeStream2(stream, cb);
        } else {
            this.removeStream3(stream, cb);
        }
    },


    removeStream2: function (stream, cb) {
        var self = this;

        cb = cb || function () {};

        stream.getTracks().forEach(function(track){
            track.onended = null;
            track.stop();
        });

        var desc = this.pc.localDescription;
        desc.contents.forEach(function (content) {
            filterContentSources(content, stream);
        });
        desc.contents = desc.contents.filter(function (content) {
            return content.description.descType === 'rtp' && content.description.sources && content.description.sources.length;
        });
        delete desc.groups;

        this.send('source-remove', desc);
        this.pc.removeStream(stream);

        this.pc.handleOffer({
            type: 'offer',
            jingle: this.pc.remoteDescription
        }, function (err) {
            if (err) {
                self._log('error', 'Could not process offer for removing stream');
                return cb(err);
            }
            self.pc.answer(function (err) {
                if (err) {
                    self._log('error', 'Could not process answer for removing stream');
                    return cb(err);
                }
                cb();
            });
        });
    },

    removeStream3: function(stream, cb){
        var self = this;
        if(navigator.mozGetUserMedia){
            this.pc.getSenders().forEach(function(sender){
                stream.getTracks().forEach(function(track){
                    if(track == sender.track){
                        self.pc.removeTrack(sender);
                    }
                })
            });
        } else {
            this.pc.removeStream(stream);
        }
        stream.getTracks().forEach(function(track){
            track.onended = null;
            track.stop();
        });
        if(navigator.mozGetUserMedia) {
            setTimeout(function(){
                self.emit('NegotiationNeeded');
            },500);
        }
        this.once('NegotiationNeeded',function(){
            var self = this;
            if(navigator.mozGetUserMedia) {
                offerOptions = {
                    offerToReceiveAudio: true,
                    offerToReceiveVideo: true
                };
            } else {
                offerOptions = {};
                offerOptions.mandatory = {};
                offerOptions.mandatory.OfferToReceiveAudio = true;
                offerOptions.mandatory.OfferToReceiveVideo = true;
            }
            self.pc.offer(offerOptions, function (err, offer) {
                if (err) {
                    self._log('error', 'Could not create WebRTC offer', err);
                    return self.end('failed-application', true);
                }
                //offer.jingle.contents.forEach(filterUnusedLabels);

                self.send('source-remove', offer.jingle);
            });
        });
    },


    switchStream: function (oldStream, newStream, cb) {
        var ua = this.pc.isInitiator ? this.pc.calleeBrowser : this.pc.callerBrowser;
        if (ua == 'jvb'){
            this.switchStream2(oldStream, newStream, cb);
        } else {
            this.switchStream3(oldStream, newStream, cb);
        }
    },


    switchStream2: function (oldStream, newStream, cb) {
        var self = this;

        cb = cb || function () {};

        var desc = this.pc.localDescription;
        desc.contents.forEach(function (content) {
            delete content.transport;
            delete content.description.payloads;
        });

        this.pc.removeStream(oldStream);
        this.send('source-remove', desc);
        this.pc.addStream(newStream);
        this.pc.handleOffer({
            type: 'offer',
            jingle: this.pc.remoteDescription
        }, function (err) {
            if (err) {
                self._log('error', 'Could not process offer for switching streams');
                return cb(err);
            }
            self.pc.answer(function (err, answer) {
                if (err) {
                    self._log('error', 'Could not process answer for switching streams');
                    return cb(err);
                }
                answer.jingle.contents.forEach(function (content) {
                    delete content.transport;
                    delete content.description.payloads;
                });
                self.send('source-add', answer.jingle);
                cb();
            });
        });
    },


    switchStream3: function (oldStream, newStream, cb) {
        var self = this;

        cb = cb || function () {};
        this.pc.removeStream(oldStream);
        this.pc.addStream(newStream);
        if(navigator.mozGetUserMedia) {
            setTimeout(function(){
                self.emit('NegotiationNeeded');
            },500);
        }
        this.once('NegotiationNeeded',function(){
            var self = this;
            if(navigator.mozGetUserMedia) {
                offerOptions = {
                    offerToReceiveAudio: true,
                    offerToReceiveVideo: true
                };
            } else {
                offerOptions = {};
                offerOptions.mandatory = {};
                offerOptions.mandatory.OfferToReceiveAudio = true;
                offerOptions.mandatory.OfferToReceiveVideo = true;
            }
            self.pc.offer(offerOptions, function (err, offer) {
                if (err) {
                    self._log('error', 'Could not create WebRTC offer', err);
                    return self.end('failed-application', true);
                }
                offer.jingle.contents.forEach(filterUnusedLabels);

                self.send('source-add', offer.jingle);
            });
        });
    },

// ----------------------------------------------------------------
// ICE action handers
// ----------------------------------------------------------------

    onIceCandidate: function (candidate) {
        this._log('info', 'Discovered new ICE candidate', candidate.jingle);
        if(candidate.jingle.contents["0"].transport.candidates["0"].type === 'relay') {
            this.send('transport-info', candidate.jingle);
        }
    },

    onIceEndOfCandidates: function () {
        this._log('info', 'ICE end of candidates');
    },

    onIceStateChange: function () {
        switch (this.pc.iceConnectionState) {
            case 'checking':
                this.connectionState = 'connecting';
                break;
            case 'completed':
            case 'connected':
                this.connectionState = 'connected';
                break;
            case 'disconnected':
                if (this.pc.signalingState === 'stable') {
                    this.connectionState = 'interrupted';
                } else {
                    this.connectionState = 'disconnected';
                }
                break;
            case 'failed':
                this.connectionState = 'failed';
                this.end('failed-transport');
                break;
            case 'closed':
                this.connectionState = 'disconnected';
                break;
        }
    },

// ----------------------------------------------------------------
// Stream event handlers
// ----------------------------------------------------------------

    onAddStream: function (event) {
        this._log('info', 'Stream added');
        this.emit('peerStreamAdded', this, event.stream);
    },

    onRemoveStream: function (event) {
        this._log('info', 'Stream removed');
        this.emit('peerStreamRemoved', this, event.stream);
    },

// ----------------------------------------------------------------
// Jingle action handers
// ----------------------------------------------------------------

    onSessionInitiate: function (changes, cb) {
        var self = this;

        this._log('info', 'Initiating incoming session');

        this.state = 'pending';
        this.pc.isInitiator = false;
        this.pc.handleOffer({
            type: 'offer',
            jingle: changes,
            initial: true
        }, function (err) {
            if (err) {
                self._log('error', 'Could not create WebRTC answer');
                return cb({condition: 'general-error'});
            }
            cb();
        });
    },

    onSessionAccept: function (changes, cb) {
        var self = this;

        this.state = 'active';
        this.pc.handleAnswer({
            type: 'answer',
            jingle: changes
        }, function (err) {
            if (err) {
                self._log('error', 'Could not process WebRTC answer');
                return cb({condition: 'general-error'});
            }
            self.emit('accepted', self);
            cb();
        });
    },

    onSessionTerminate: function (changes, cb) {
        var self = this;

        this._log('info', 'Terminating session');
        this.streams.forEach(function (stream) {
            self.onRemoveStream({stream: stream});
        });
        this.pc.close();
        BaseSession.prototype.end.call(this, changes.reason, true);

        cb();
    },

    onSessionInfo: function (info, cb) {
        if (info.ringing) {
            this._log('info', 'Outgoing session is ringing');
            this.ringing = true;
            this.emit('ringing', this, info.ringing);
            return cb();
        }

        if (info.hold) {
            this._log('info', 'On hold');
            this.emit('hold', this);
            return cb();
        }

        if (info.active) {
            this._log('info', 'Resuming from hold');
            this.emit('resumed', this);
            return cb();
        }

        if (info.mute) {
            this._log('info', 'Muting', info.mute);
            this.emit('mute', this, info.mute);
            return cb();
        }

        if (info.unmute) {
            this._log('info', 'Unmuting', info.unmute);
            this.emit('unmute', this, info.unmute);
            return cb();
        }

        cb();
    },

    onTransportInfo: function (changes, cb) {
        this.pc.processIce(changes, function () {
            cb();
        });
    },

    onSourceAdd: function (changes, cb) {
        var self = this;
        this._log('info', 'Adding new stream source');
        var ua = this.pc.isInitiator ? this.pc.calleeBrowser : this.pc.callerBrowser;
        if (ua !== 'jvb'){
            this.pc.handleOffer({
                type: 'offer',
                jingle: changes
            }, function (err) {
                if (err) {
                    self._log('error', 'Error adding new stream source');
                    return cb({
                        condition: 'general-error'
                    });
                }

                self.pc.answer(function (err, answer) {
                    if (err) {
                        self._log('error', 'Error adding new stream source');
                        return cb({
                            condition: 'general-error'
                        });
                    }
                    answer.jingle.contents.forEach(filterUnusedLabels);

                    self.send('session-accept', answer.jingle);
                    cb();
                });
            });
        } else {
            var newDesc = this.pc.remoteDescription;
            this.pc.remoteDescription.contents.forEach(function (content, idx) {
                var desc = content.description;
                var ssrcs = desc.sources || [];
                var groups = desc.sourceGroups || [];

                changes.contents.forEach(function (newContent) {
                    if (content.name !== newContent.name) {
                        return;
                    }

                    var newContentDesc = newContent.description;
                    var newSSRCs = newContentDesc.sources || [];

                    ssrcs = ssrcs.concat(newSSRCs);
                    newDesc.contents[idx].description.sources = JSON.parse(JSON.stringify(ssrcs));

                    var newGroups = newContentDesc.sourceGroups || [];
                    groups = groups.concat(newGroups);
                    newDesc.contents[idx].description.sourceGroups = JSON.parse(JSON.stringify(groups));
                });
            });

            this.pc.handleOffer({
                type: 'offer',
                jingle: newDesc
            }, function (err) {
                if (err) {
                    self._log('error', 'Error adding new stream source');
                    return cb({
                        condition: 'general-error'
                    });
                }

                self.pc.answer(null, function (err, answer) {
                    if (err) {
                        self._log('error', 'Error adding new stream source');
                        return cb({
                            condition: 'general-error'
                        });
                    }
                    // answer.jingle.contents.forEach(filterUnusedLabels);

                    //self.send('session-accept', answer.jingle);
                    cb();
                });
            });
        }
    },

    onSourceRemove: function (changes, cb) {
        var self = this;
        this._log('info', 'Removing stream source');
        var ua = this.pc.isInitiator ? this.pc.calleeBrowser : this.pc.callerBrowser;
        if (ua !== 'jvb'){
            this.pc.handleOffer({
                type: 'offer',
                jingle: changes
            }, function (err) {
                if (err) {
                    self._log('error', 'Error removing stream source');
                    return cb({
                        condition: 'general-error'
                    });
                }
                self.pc.answer(function (err, answer) {
                    if (err) {
                        self._log('error', 'Error removing stream source');
                        return cb({
                            condition: 'general-error'
                        });
                    }
                    self.send('session-accept', answer.jingle);
                    cb();
                });
            });
        } else {
            var newDesc = this.pc.remoteDescription;
            this.pc.remoteDescription.contents.forEach(function (content, idx) {
                var desc = content.description;
                var ssrcs = desc.sources || [];
                var groups = desc.sourceGroups || [];

                changes.contents.forEach(function (newContent) {
                    if (content.name !== newContent.name) {
                        return;
                    }

                    var newContentDesc = newContent.description;
                    var newSSRCs = newContentDesc.sources || [];
                    var newGroups = newContentDesc.sourceGroups || [];

                    var found, i, j, k;


                    for (i = 0; i < newSSRCs.length; i++) {
                        found = -1;
                        for (j = 0; j < ssrcs.length; j++) {
                            if (newSSRCs[i].ssrc === ssrcs[j].ssrc) {
                                found = j;
                                break;
                            }
                        }
                        if (found > -1) {
                            ssrcs.splice(found, 1);
                            newDesc.contents[idx].description.sources = JSON.parse(JSON.stringify(ssrcs));
                        }
                    }

                    // Remove ssrc-groups that are no longer needed
                    for (i = 0; i < newGroups.length; i++) {
                        found = -1;
                        for (j = 0; j < groups.length; j++) {
                            if (newGroups[i].semantics === groups[j].semantics &&
                                newGroups[i].sources.length === groups[j].sources.length) {
                                var same = true;
                                for (k = 0; k < newGroups[i].sources.length; k++) {
                                    if (newGroups[i].sources[k] !== groups[j].sources[k]) {
                                        same = false;
                                        break;
                                    }
                                }
                                if (same) {
                                    found = j;
                                    break;
                                }
                            }
                        }
                        if (found > -1) {
                            groups.splice(found, 1);
                            newDesc.contents[idx].description.sourceGroups = JSON.parse(JSON.stringify(groups));
                        }
                    }
                });
            });
            this.pc.handleOffer({
                type: 'offer',
                jingle: newDesc
            }, function (err) {
                if (err) {
                    self._log('error', 'Error removing stream source');
                    return cb({
                        condition: 'general-error'
                    });
                }
                self.pc.answer(function (err, answer) {
                    if (err) {
                        self._log('error', 'Error removing stream source');
                        return cb({
                            condition: 'general-error'
                        });
                    }
                    //self.send('session-accept', answer.jingle);
                    cb();
                });
            });
        }
    },

// ----------------------------------------------------------------
// DataChannels
// ----------------------------------------------------------------
    onAddChannel: function (channel) {
        this.emit('addChannel', channel);
    }
});


module.exports = MediaSession;
