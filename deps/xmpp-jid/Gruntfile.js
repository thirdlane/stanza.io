'use strict';

module.exports = function (grunt) {
    grunt.initConfig({
        pkg: grunt.file.readJSON('package.json'),
        browserify: {
            dist: {
                files: {
                    'build/xmpp-jid.bundle.js': ['<%= pkg.main %>']
                },
                options: {
                    bundleOptions: {
                        standalone: 'JID'
                    }
                }
            }
        },
        uglify: {
            options: {
                banner: '/*! xmpp-jid <%= grunt.template.today("yyyy-mm-dd") %>*/'
            },
            dist: {
                files: {
                    'build/xmpp-jid.bundle.min.js': ['build/xmpp-jid.bundle.js']
                }
            }
        },
        jshint: {
            files: [
                'Gruntfile.js',
                'index.js',
                'test/**.js'
            ],
            options: grunt.file.readJSON('.jshintrc')
        },
        tape: {
            options: {
                pretty: true
            },
            files: ['test/**.js']
        }
    });

    grunt.loadNpmTasks('grunt-browserify');
    grunt.loadNpmTasks('grunt-contrib-uglify');
    grunt.loadNpmTasks('grunt-contrib-jshint');
    grunt.loadNpmTasks('grunt-tape');
    grunt.loadNpmTasks('grunt-nsp-package');

    grunt.registerTask('default', ['jshint', 'browserify', 'uglify', 'tape', 'validate-package']);
};
