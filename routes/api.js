const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const sql = require('mssql');
const fs = require('fs');

const Module = require('../models/module');
const LectureHour = require('../models/lecture-hour');
const verifyToken = require('../modules/user-verification').VerifyToken;

const Errors = require('../errors/errors');
const emailVerification = require('../modules/email-verification');
const {calculateGPA} = require("../modules/caculate-gpa");
const {poolPromise} = require('../modules/sql-connection');

router.post('/send-password-reset-email', async (request, response) => {

    let username = request.body.username;

    try {
        const pool = await poolPromise;
        await pool.request()
            .input('username', sql.Char(7), username)
            .query('SELECT email, firstName, lastName FROM Users WHERE username = @username', (error, result) => {
                if (error) {
                    response.status(500).send(Errors.serverError);
                } else {
                    if (result.recordset[0]) {
                        const user = result.recordset[0];
                        user.token = jwt.sign({
                            username: username,
                            timeSent: Date.now()
                        }, 'password_reset');
                        emailVerification.sendPasswordResetEmail(user, status => {
                            if (status) {
                                response.status(200).send({
                                    status: true,
                                    message: 'Password reset mail sent.'
                                });
                            } else {
                                response.status(500).send({
                                    status: false,
                                    message: 'Could not send the password reset email'
                                });
                            }

                        });
                    } else {
                        response.status(404).send({
                            status: false,
                            message: 'Username you entered is not found..!'
                        });
                    }
                }
            });
    } catch (error) {
        response.status(500).send(Errors.serverError);
    }

});

router.post('/reset-password', async (request, response) => {

    const data = request.body;

    if (data.hasOwnProperty('token') && data.token) {
        const payload = jwt.verify(data.token, 'password_reset');
        if (!payload) {
            response.status(false).send(Errors.unauthorizedRequest);
        } else {
            if (Date.now() - payload.timeSent > 300000) {
                response.status(401).send({
                    status: false,
                    message: 'This password change request request has timed out..!'
                })
            } else {
                const pool = await poolPromise;
                await pool.request()
                    .input('username', sql.Char(7), payload.username)
                    .input('password', sql.VarChar(50), data.password)
                    .execute('changePassword', (error, result) => {
                        if (error) {
                            response.status(500).send(Errors.serverError);
                        } else {
                            if (result.returnValue === -1) {
                                response.status(401).send(Errors.unauthorizedRequest);
                            } else {
                                response.status(200).send({
                                    status: true,
                                    message: 'Password changed successfully'
                                });
                            }
                        }
                    });
            }
        }
    } else {
        response.status(401).send(Errors.unauthorizedRequest);
    }

});

router.post('/change-password', verifyToken, async (request, response) => {
    const data = request.body;
    if (data.token) {
        const payload = jwt.verify(data.token, 'verify_email');
        if (payload.hasOwnProperty('username') && payload.hasOwnProperty('timeSent') && payload.username === request.username) {
            if (Date.now() - payload.timeSent > 300000) {
                response.status(401).send({
                    status: false,
                    message: 'This email verification request has timed out'
                });
            } else {
                try {
                    const pool = await poolPromise;
                    await pool.request()
                        .input('username', sql.Char(7), payload.username)
                        .input('password', sql.VarChar(50), data.password)
                        .query('UPDATE Users SET password = @password, verified = 1 WHERE username = @username', (error, result) => {
                            if (error) {
                                response.status(500).send(Errors.serverError);
                            } else {
                                if (result.returnValue === -1) {
                                    response.status(401).send(Errors.unauthorizedRequest);
                                } else {
                                    response.status(200).send({
                                        status: true,
                                        message: 'Password changed successfully'
                                    });
                                }
                            }
                        });
                } catch (error) {
                    response.status(500).send(Errors.serverError);
                }
            }
        } else {
            response.status(200).send(Errors.unauthorizedRequest);
        }
    } else {
        response.status(401).send(Errors.unauthorizedRequest);
    }
});

router.post('/change-password-current', verifyToken, async (request, response) => {

    const data = request.body;
    console.log(request.body);

    if (data.hasOwnProperty('currentPassword') && data.hasOwnProperty('newPassword') && data.hasOwnProperty('confirmPassword')) {

        if (data.newPassword === data.confirmPassword) {
            if (data.newPassword !== data.currentPassword) {
                try {
                    const pool = await poolPromise;
                    await pool.request()
                        .input('username', sql.Char(7), request.username)
                        .input('newPassword', sql.VarChar(50), data.newPassword)
                        .input('currentPassword', sql.VarChar(50), data.currentPassword)
                        .execute('changePasswordWithCurrent', (error, result) => {
                            if (error) {
                                response.status(500).send(Errors.serverError);
                            } else {
                                if (result.returnValue === 0) {
                                    response.status(200).send({
                                        status: true,
                                        message: 'Password updated successfully'
                                    });
                                } else {
                                    response.status(401).send(Errors.unauthorizedRequest);
                                }
                            }
                        });
                } catch (error) {
                    response.status(500).send(Errors.serverError);
                }
            } else {
                response.status(400).send({
                    status: false,
                    message: 'New password cannot be the old password'
                })
            }
        } else {
            response.status(400).send({
                status: false,
                message: 'Passwords do not match'
            });
        }

    } else {
        response.status(400).send({
            status: false,
            message: 'Malformed request body'
        });
    }

});

router.post('/verify-recovery-email', verifyToken, async (request, response) => {

    const token = request.body.token;
    if (token) {
        const payload = jwt.verify(token, 'verify_email');
        if (payload.hasOwnProperty('username') && payload.hasOwnProperty('timeSent') && payload.username === request.username) {
            if (Date.now() - payload.timeSent > 300000) {
                response.status(401).send({
                    status: false,
                    message: 'This email verification request has timed out'
                });
            } else {
                try {
                    const pool = await poolPromise;
                    await pool.request()
                        .input('username', sql.Char(7), payload.username)
                        .input('email', sql.VarChar(50), payload.email)
                        .query('UPDATE Users SET recoveryEmail = @email, verified = 1 WHERE username = @username', (error, result) => {
                            if (error) {
                                response.status(500).send(Errors.serverError);
                            } else {
                                if (result.returnValue === -1) {
                                    response.status(401).send(Errors.unauthorizedRequest);
                                } else {
                                    response.status(200).send({
                                        status: true,
                                        message: 'Password changed successfully'
                                    });
                                }
                            }
                        });
                } catch (error) {
                    response.status(500).send(Errors.serverError);
                }
            }
        } else {
            response.status(200).send(Errors.unauthorizedRequest);
        }
    } else {
        response.status(401).send(Errors.unauthorizedRequest);
    }

});

router.post('/login', async (request, response) => {
    let userData = request.body;
    try {
        const pool = await poolPromise;
        const result = await pool.request()
            .input('username', sql.Char(7), userData.username)
            .input('password', sql.VarChar(20), userData.password)
            .execute('checkUserCredentials', (error, result) => {
                if (error) {
                    response.status(500).send(Errors.serverError);
                } else {
                    if (result.returnValue === 1) {
                        let user = result.recordset[0];
                        user.token = jwt.sign({subject: user.username, role: user.roleName}, 'secret_key');
                        response.status(200).send(user);
                    } else {
                        response.status(401).send({
                            status: false,
                            message: 'Username or password is incorrect!'
                        });
                    }
                }
            });
    } catch (error) {
        response.status(500).send(Errors.serverError);
    }
});

router.post('/send-verification-email', verifyToken, async (request, response) => {


    const email = request.body.email;

    if (!request.verified && email) {

        try {
            const pool = await poolPromise;
            await pool.request()
                .input('username', sql.Char(7), request.username)
                .input('email', sql.VarChar(50), email)
                .query(
                    'UPDATE Users SET recoveryEmail = @email WHERE username = @username; ' +
                    'SELECT username, firstName, lastName FROM Users WHERE username = @username',
                    (error, result) => {
                        if (error) {
                            response.status(500).send(Errors.serverError);
                        } else {
                            const user = result.recordset[0];
                            user.token = jwt.sign({
                                username: user.username,
                                email: email,
                                timeSent: Date.now()
                            }, 'verify_email');
                            user.email = email;

                            emailVerification.sendVerificationEmail(user, 'verification', (status) => {
                                if (status) {
                                    response.status(200).send({
                                        status: true,
                                        message: 'Verification email sent'
                                    })
                                } else {
                                    response.status(500).send(Errors.serverError);
                                }
                            });
                        }
                    });
        } catch (error) {
            response.status(500).send(Errors.serverError);
        }
    } else {
        response.status(401).send(Errors.unauthorizedRequest);
    }

});

router.post('/send-recovery-email-verification', verifyToken, async (request, response) => {

    const email = request.body.email;

    try {

        const pool = await poolPromise;
        await pool.request()
            .input('username', sql.Char(7), request.username)
            .query('SELECT firstName, lastName FROM Users WHERE username = @username', (error, result) => {
                if (error) {
                    response.status(500).send(Errors.serverError);
                    console.log(error);
                } else {
                    const user = result.recordset[0];
                    user.token = jwt.sign({
                        username: request.username,
                        email: email,
                        timeSent: Date.now()
                    }, 'verify_email');
                    user.email = email;
                    emailVerification.sendVerificationEmail(user, 'change-recovery-email', (status) => {
                        if (status) {
                            response.status(200).send({
                                status: true,
                                message: 'Verification email sent'
                            })
                        } else {
                            response.status(500).send(Errors.serverError);
                        }
                    });
                }
            });


    } catch (error) {
        console.log(error);
        response.status(500).send(Errors.serverError);
    }

});

router.post('/get-modules', verifyToken, async (request, response) => {
    const username = request.username;
    try {
        const pool = await poolPromise;
        const result = await pool.request()
            .input('username', sql.Char(7), username)
            .input('role', sql.Int, request.role)
            .execute('getModules', (error, result) => {
                if (error) {
                    response.status(500).send(Errors.serverError);
                } else {
                    response.status(200).send({
                        status: true,
                        modules: result.recordsets[0],
                        teachers: result.recordsets[1],
                        lectureHours: result.recordsets[2],
                        course: (request.role === 3) ? result.recordsets[3][0].courseName : ''
                    });

                }
            });
    } catch (error) {
        response.status(500).send(Errors.serverError);
    }
});

router.post('/get-attendance', verifyToken, async (request, response) => {

    try {
        const pool = await poolPromise;
        const result = await pool.request()
            .input('studentID', sql.Char(7), request.username)
            .execute('getAttendance', (error, result) => {
                if (error) {
                    response.status(500).send(Errors.serverError);
                } else {
                    response.status(200).send({
                        status: true,
                        attendance: result.recordset
                    });
                }
            });
    } catch (error) {
        response.status(500).send(Errors.serverError);
    }

});

router.post('/get-detailed-attendance', verifyToken, async (request, response) => {
    const info = request.body;
    try {
        const pool = await poolPromise;
        const result = await pool.request()
            .input('studentID', sql.Char(7), request.username)
            .input('moduleCode', sql.Char(6), info.moduleCode)
            .input('type', sql.VarChar(15), info.type)
            .input('batch', sql.Int, info.batch)
            .execute('getDetailedAttendance', (error, result) => {
                if (error) {
                    response.status(500).send(Errors.serverError);
                } else {
                    response.status(200).send(result.recordset);
                }
            });
    } catch (error) {
        response.status(500).send(Errors.serverError);
    }
});

router.post('/get-lecture-hours', verifyToken, function (request, response) {
    LectureHour.find({}, {_id: 0, completedLectures: 0, __v: 0}, (error, lectureHours) => {
        if (error) {
            response.status(500).send(Errors.serverError);
        } else {
            Module.find({}, {_id: 0, teachers: 0, credits: 0, description: 0, __v: 0}, (error, modules) => {
                if (error) {
                    response.status(500).send(Errors.serverError);
                } else {
                    response.status(200).send({
                        status: true,
                        modules: modules,
                        lectureHours: lectureHours
                    })
                }
            });
        }
    });
});

router.post('/get-results', verifyToken, async (request, response) => {
    const studentID = request.username;

    try {
        const pool = await poolPromise;
        pool.request()
            .input('studentID', sql.Char(7), studentID)
            .execute('getResults', (error, result) => {
                if (error) {
                    response.status(500).send(Errors.serverError);
                } else {
                    const moduleCodes = new Set();
                    for (const examResult of result.recordset) {
                        moduleCodes.add(examResult.moduleCode);
                    }

                    const examResults = [];
                    for (const moduleCode of moduleCodes) {
                        const temp = result.recordset.filter(obj => obj.moduleCode === moduleCode);
                        if (temp.length > 1) {
                            temp.sort((a, b) => a.academicYear < b.academicYear ? 1 : -1);
                            for (let i = 0; i < temp.length - 1; i++) {
                                if (temp[i].mark > 54) {
                                    temp[i].grade = 'C'
                                }
                            }
                        }
                        for (let obj of temp) {
                            delete obj.mark;
                            examResults.push(obj);
                        }
                    }

                    response.status(200).send({
                        status: true,
                        results: examResults
                    });
                }
            });
    } catch (error) {
        response.status(500).send(Errors.serverError);
    }

});

router.post('/upload-profile-picture', verifyToken, async (request, response) => {

    const image = request.body.profilePicture;

    try {
        if (!image) {
            response.status(401).send({
                status: false,
                message: 'Image not found'
            });
        } else {
            const path = './profile-pictures/' + request.username + '.png';
            const base64Data = image.replace(/^data:([A-Za-z-+/]+);base64,/, '');
            fs.writeFileSync(path, base64Data, {encoding: 'base64'});
            response.send({
                status: true,
                message: 'profile picture updated successfully'
            });
        }
    } catch (error) {
        response.status(500).send(Errors.serverError);
    }

});

router.post('/get-profile-picture', verifyToken, async (request, response) => {

    try {
        const image = fs.readFileSync(`./profile-pictures/${request.username}.png`, {encoding: 'base64'});
        response.status(200).send({
            status: true,
            profilePicture: image
        });
    } catch (error) {
        if (error.errno === -4058) {
            const image = fs.readFileSync('./profile-pictures/default.png', {encoding: 'base64'});
            response.status(200).send({
                status: true,
                profilePicture: image
            });
        } else {
            response.status(500).send(Errors.serverError);
        }
    }

});

router.get('/get-timetable/:username/:role', async (request, response) => {

    try {

        const pool = await poolPromise;
        await pool.request()
            .input('username', sql.Char(7), request.params.username)
            .input('role', sql.Int, request.params.role)
            .execute('getTimetables', (error, result) => {
                if (error) {
                    response.status(500).send(Errors.serverError);
                } else {
                    const data = result.recordset.map(session => {
                        return {
                            Id: session.lectureHourID,
                            Subject: session.moduleCode + ' ' + session.moduleName,
                            StartTime: new Date(session.startingTime),
                            EndTime: new Date(session.endingTime),
                            Description: session.type,
                            LectureHall: session.lectureHall,
                            day: session.day,
                            IsAllDay: false
                        };
                    });
                    response.status(200).send(data);
                }
            });

    } catch (error) {
        response.status(500).send(Errors.serverError);
    }

});

router.post('/get-user-details', verifyToken, async (request, response) => {

    const username = request.username;

    let gpa;
    await calculateGPA(username, value => gpa = value);

    try {

        const pool = await poolPromise;
        await pool.request()
            .input('username', sql.Char(7), username)
            .input('roleID', sql.Int, request.role)
            .execute('getUserDetails', (error, result) => {
                if (error) {
                    response.status(500).send(Errors.serverError);
                } else {
                    const res = {
                        status: true,
                        details: result.recordsets[0][0],
                        educationQualifications: result.recordsets[1]
                    }
                    res.details.currentGPA = gpa;
                    response.status(200).send(res);
                }
            });

    } catch (error) {
        response.status(500).send(Errors.serverError);
    }

});

router.post('/get-notifications', verifyToken, async (request, response) => {
    const username = request.username;
    try {
        const pool = await poolPromise;
        await pool.request()
            .input('username', sql.Char(7), username)
            .execute('getNotifications', (error, result) => {
                if (error || result.returnValue === -1) {
                    response.status(500).send(Errors.serverError);
                } else {
                    response.status(200).send({
                        status: true,
                        notifications: result.recordset
                    });
                }
            });
    } catch (error) {
        response.status(500).send(Errors.serverError);
    }

});

router.post('/update-notification-status', verifyToken, async (request, response) => {
    const received = request.body.received;
    const receiverID = request.username;
    try {
        const notifications = new sql.Table('NOTIFICATIONS')
        notifications.columns.add('notificationID', sql.Int)
        for (let notificationID of received) {
            notifications.rows.add(notificationID)
        }
        const pool = await poolPromise;
        await pool.request()
            .input('receiverID', sql.Char(7), receiverID)
            .input('notifications', notifications)
            .execute('updateNotificationStatus', (error, result) => {
                if (error) {
                    response.status(500).send(Errors.serverError);
                } else {
                    response.status(200).send({
                        status: true,
                        message: 'Notification status updated successfully'
                    });
                }
            });
    } catch (error) {
        response.status(500).send(Errors.serverError);
    }

});

router.post('/get-requests', verifyToken, async (request, response) => {

    try {
        const pool = await poolPromise;
        await pool.request()
            .input('studentID', sql.Char(7), request.username)
            .execute('getRequests', (error, result) => {
                if (error) {
                    response.status(200).send(Errors.serverError);
                } else {
                    const requests = result.recordsets[0];
                    for (const request of requests) {
                        request.requestTypes = result.recordsets[1].filter(req => req.requestID === request.requestID);
                        request.reasons = result.recordsets[2].filter(reason => reason.requestID === request.requestID);
                        request.reviewedBy = result.recordsets[3].filter(step => step.requestID === request.requestID);
                    }
                    response.status(200).send({
                        status: true,
                        message: 'Request received successfully',
                        requests
                    });
                }
            });
    } catch (error) {
        response.status(500).send(Errors.serverError);
    }

});

router.post('/get-academic-calenders', verifyToken, async (request, response) => {

    try {
        const pool = await poolPromise;
        pool.request()
            .execute('getAcademicCalenders', (error, result) => {
                if (error) {
                    response.status(500).send(Errors.serverError);
                } else {
                    const academicYears = result.recordsets[0];
                    const academicYearTasks = result.recordsets[1];
                    const academicCalenders = [];
                    for (let academicYear of academicYears) {
                        academicCalenders.push({
                            year: academicYear.academicYear,
                            data: academicYearTasks.filter(obj => obj.AcademicYear === academicYear.academicYear)
                        });
                    }
                    response.status(200).send({
                        status: true,
                        message: 'Request status updated successfully',
                        academicCalenders: academicCalenders
                    });
                }
            });
    } catch (error) {
        response.status(500).send(Errors.serverError);
    }

});

router.post('/update-user-data', verifyToken, async (request, response) => {

    console.log(request.role);

    const data = request.body;
    console.log(data);
    let query;

    if (data.hasOwnProperty('email')) {
        query = `UPDATE Users SET email = '${data.email}' WHERE username = '${request.username}'`
    } else {
        if (request.role === 1) {
            if (data.hasOwnProperty('phone')) {
                query = `UPDATE Admin SET mobile = '${data.phone}' WHERE adminID = '${request.username}'`
            }
        } else if (request.role === 2) {
            if (data.hasOwnProperty('phone')) {
                query = `UPDATE Teacher SET mobile = '${data.phone}' WHERE teacherID = '${request.username}'`
            }
        } else if (request.role === 3) {
            if (data.hasOwnProperty('phone')) {
                query = `UPDATE Student SET mobile = '${data.phone}' WHERE studentID = '${request.username}'`
            } else if (data.hasOwnProperty('address')) {
                query = `UPDATE Student SET address = '${data.address}' WHERE studentID = '${request.username}'`
            }
        }
    }

    if (query) {
        try {

            const pool = await poolPromise;
            await pool.request()
                .query(query, (error, result) => {
                    if (error) {
                        response.status(500).send(Errors.serverError);
                    } else {
                        response.status(200).send({
                            status: true,
                            message: 'Email updated successfully'
                        });
                    }
                });

        } catch (error) {
            response.status(500).send(Errors.serverError);
        }
    } else {
        response.status(400).send({
            status: false,
            message: 'Malformed request'
        })
    }

});

router.post('/get-academic-years', verifyToken, async (request, response) => {

    try {
        const pool = await poolPromise;
        await pool.request()
            .query('SELECT * FROM AcademicCalender', (error, result) => {
                if (error) {
                    response.status(500).send(Errors.serverError);
                } else {
                    const academicYears = result.recordset.map(obj => obj.academicYear);
                    response.status(200).send({
                        status: true,
                        academicYears: academicYears
                    });
                }
            });
    } catch (error) {
        response.status(500).send(Errors.serverError);
    }

});

module.exports = router;
