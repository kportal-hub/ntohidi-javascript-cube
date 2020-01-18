const fs = require('fs');
const shell = require("shelljs")
const axios = require("axios");
const Octokit = require("@octokit/rest");
// const crypto = require('crypto');
const { createCipheriv, createDecipheriv, randomBytes } = require('crypto');

const inputEncoding = 'utf8';
const outputEncoding = 'hex';

async function encrypt(content, algorithm, key) {
    try {
        key = key.substr(key.length - 32);
        const iv = new Buffer.from(randomBytes(16), 'hex');
        const cipher = createCipheriv(algorithm, key, iv);
        let crypted = cipher.update(content, inputEncoding, outputEncoding);
        crypted += cipher.final(outputEncoding);
        return `${iv.toString('hex')}:${crypted.toString()}`;
    } catch (err) {
        console.log(err.message);
        throw err
    }
}

async function decrypt(content, algorithm, key) {
    try {
        key = key.substr(key.length - 32);
        const textParts = content.split(':');
        const IV = new Buffer.from(textParts.shift(), outputEncoding);
        const encryptedText = new Buffer.from(textParts.join(':'), outputEncoding);
        const decipher = createDecipheriv(algorithm, key, IV);
        let decrypted = decipher.update(encryptedText, outputEncoding, inputEncoding);
        decrypted += decipher.final(inputEncoding);
        return decrypted.toString()
        // return {
        //     result: true,
        //     decrypted: decrypted.toString()
        // }
    } catch (err) {
        console.log(err)
        throw err
    }
}

async function encryptAndPutAuthFile(username, repo, algorithm, gitToken, authPhrase, _silent) {
    try {
        // var cipher = crypto.createCipher(algorithm, gitToken);
        // var encryptedPhrase = cipher.update(authPhrase, 'utf8', 'hex');
        // encryptedPhrase += cipher.final('hex');
        let encryptedPhrase = await encrypt(authPhrase, algorithm, gitToken);
        shell.exec(`git checkout master`, {silent: _silent});
        shell.exec(`echo ${encryptedPhrase} > auth`, {silent: _silent});
        shell.exec(`git add auth`, {silent: _silent});
        shell.exec(`git commit -m 'add auth file'`, {silent: _silent});
        shell.exec(`git push https://${username}:${gitToken}@github.com/${repo} master`, {silent: _silent});
        return true
    } catch (err) {
        throw err
    }
}

async function getUserTokenAndDecrypt(repo, algorithm, pwd) {
    try {
        let resp = await axios.get(`https://api.github.com/repos/${repo}/contents/auth`);
        if(!resp.data.content)
            throw new Error("No auth file found");
        let content = Buffer.from(resp.data.content, 'base64').toString('ascii').replace(/\n/g, "");
        // var decipher = crypto.createDecipher(algorithm, pwd);
        // var token = decipher.update(content, 'hex', 'utf8');
        // token += decipher.final('utf8');
        let token = await decrypt(content, algorithm, pwd);
        return token;
    } catch (err) {
        throw err
    }
}

async function fetchLesson(cube, qHub, qHubCube, token) {
    console.log("Getting first lesson name...");
    try {
        let octokit = new Octokit({
            auth: "token " + token
        });
        // let resp = await octokit.repos.getContents({
        //     owner: qHub,
        //     repo: qHubCube,
        //     path: `default.index`,
        //     headers: {
        //         'accept': 'application/vnd.github.VERSION.raw'
        //     }
        // });
        // return resp.data.split("\n").filter(Boolean)
        
        let resp = await octokit.repos.getContents({
            owner: qHub,
            repo: qHubCube,
            path: 'default.index',
            headers: {
                'accept': 'application/vnd.github.VERSION.raw'
            }
        });
        let cubeInfo = await octokit.repos.getContents({
            owner: qHub,
            repo: qHubCube,
            path: `${cube}.cube.json`,
            headers: {
                'accept': 'application/vnd.github.VERSION.raw'
            }
        });
        return {
            result: true,
            lessons: resp.data.split("\n").filter(Boolean),
            cubeInfo: JSON.parse(cubeInfo.data)
        }
        
    } catch (err) {
        throw err
    }
}

async function getContent(owner, repo, path, ref, token) {
    try {
        let octokit = new Octokit({
            auth: "token " + token
        });
        await octokit.repos.getContents({
            owner,
            repo,
            path,
            ref
        })
        return true;
    } catch (err) {
        if(err.status== 404)
            return false
        else
            throw err
    }
}

async function deleteFile(owner, repo, path, message, branch, token) {
    try {
        let octokit = new Octokit({
            auth: "token " + token
        });
        let sha = (await octokit.repos.getContents({
            owner,
            repo,
            path,
            ref: branch
        })).data.sha;
        if (sha) {
            await octokit.repos.deleteFile({
                owner,
                repo,
                path,
                message,
                sha,
                branch
            });
            return true;
        } else {
            throw new Error(" no sha found to remove auth file in master branch in " + repo + "repo!");
        }
    } catch (err) {
        throw err
    }
}

async function pullNextLessonIntoStudentRepo(cHub, studentUsername, studentRepoName, cube, branch, newLesson, masterToken, repo, studentToken, _silent, isDone) {
    let now = +new Date();
    try {
        const cloneUrl = `https://github.com/${studentUsername}/${studentRepoName}`;
        shell.exec(`git clone ${cloneUrl} studentRepo`, { silent: _silent });
        process.chdir(process.cwd() + `/studentRepo`);
        if (!isDone) {
            shell.exec(`git checkout --orphan ${newLesson}`, { silent: _silent });
            shell.exec(`git rm -rf .`, { silent: _silent });
            shell.exec(`git pull https://${cHub}:${masterToken}@github.com/${repo}.git ${newLesson}`, { silent: _silent });
        }
        
        shell.exec(`git checkout master`, { silent: _silent });
        // update cube info
        let cubeInfo = JSON.parse(fs.readFileSync(`${cube}.cube.json`, 'utf8'));
        // let docsCubeInfo = JSON.parse(fs.readFileSync(`docs/${cube}.cube.json`, 'utf8'));
        
        cubeInfo.current.lesson = newLesson || branch;
        cubeInfo.modified = now;
        cubeInfo.result[branch].test = "done";
        // cubeInfo.lessons[branch].test.status = "done";

        // docsCubeInfo.current.lesson = cubeInfo.current.lesson;
        // docsCubeInfo.modified = now;
        // docsCubeInfo.lessons[branch].test.status = "done";

        fs.writeFileSync(`${cube}.cube.json`, JSON.stringify(cubeInfo, null, 4));

        // save in docs folder
        // fs.writeFileSync(`docs/${cube}.cube.json`, JSON.stringify(docsCubeInfo, null, 4));
        
        shell.exec(`git add --all`, { silent: _silent });
        shell.exec(`git commit -m 'Add next lesson branch'`, { silent: _silent });
        shell.exec(`git push https://${studentUsername}:${studentToken}@github.com/${studentUsername}/${studentRepoName}.git --all`, { silent: _silent });

    } catch(err){
        throw err
    }
}

async function pullNextLessonIntoChub(cube, branch, newLesson, masterToken, qHub, qHubCube, cHub, repo, _silent, isDone) {
    let now = +new Date();
    try {
        shell.exec(`git pull --all`, { silent: _silent });
        if (!isDone) {
            shell.exec(`git checkout --orphan ${newLesson}`, { silent: _silent });
            shell.exec(`git rm -rf .`, { silent: _silent });
            shell.exec(`git pull https://${qHub}:${masterToken}@github.com/${qHub}/${qHubCube}.git ${newLesson}`, { silent: _silent });
        }
        
        shell.exec(`git checkout master`, { silent: _silent });
        // update cube info
        let cubeInfo = JSON.parse(fs.readFileSync(`${cube}.cube.json`, 'utf8'));
        // let docsCubeInfo = JSON.parse(fs.readFileSync(`docs/${cube}.cube.json`, 'utf8'));
        
        cubeInfo.current.lesson = newLesson || branch;
        cubeInfo.modified = now;
        cubeInfo.result[branch].test = "done";
        // cubeInfo.lessons[branch].test.status = "done";

        // docsCubeInfo.current.lesson = cubeInfo.current.lesson;
        // docsCubeInfo.modified = now;
        // docsCubeInfo.lessons[branch].test.status = "done";

        fs.writeFileSync(`${cube}.cube.json`, JSON.stringify(cubeInfo, null, 4));

        // save in docs folder
        // fs.writeFileSync(`docs/${cube}.cube.json`, JSON.stringify(docsCubeInfo, null, 4));

        shell.exec(`git add --all`, { silent: _silent });
        shell.exec(`git commit -m 'Add next lesson branch'`, { silent: _silent });
        shell.exec(`git push https://${cHub}:${masterToken}@github.com/${repo}.git --all`);
        shell.exec(`git checkout ${branch} --`, { silent: _silent });

    } catch (err) {
        throw err
    }
}

// async function addActions(branch, username, cube, masterToken, studentToken, cHub, qHub, qHubCube) {
async function addActions(cubeType, actionsRepo, branch, username, cube, masterToken, studentToken, cHub, qHub) {
    try {
        let octokit = new Octokit({
            auth: "token " + masterToken
        });
        let stdOctokit = new Octokit({
            auth: "token " + studentToken
        });

        let d = (await octokit.repos.getContents({
            owner: qHub,
            repo: actionsRepo,
            path: "",
            ref: cubeType // "master"
        })).data;

        let cHubFiles = d.filter(f => !f.name.startsWith("onPushLesson")).map(f => f.name);
        let studentFiles = d.filter(f => f.name.startsWith("onPushLesson") || f.name.startsWith("pushTestResult")).map(f => f.name);

        console.log(`Adding actions for cHub repo, ${`${username}-${cube}-cube`}, ${branch} branch...`);
        for (let idx = 0; idx < cHubFiles.length; idx++) {
            const _file = cHubFiles[idx];
            console.log(_file);
            let d = (await octokit.repos.getContents({
                owner: qHub,
                repo: actionsRepo,
                path: _file,
                ref: cubeType // "master"
            })).data;
            let content = Buffer.from(d.content, 'base64').toString('ascii');
            if(_file.endsWith(".yaml"))
                content = content.replace(/BRANCH/g, branch);
            await octokit.repos.createOrUpdateFile({
                owner: cHub,
                repo: `${username}-${cube}-cube`,
                path: ".github/workflows/" + _file,
                message: "initial commit",
                content: Buffer.from(content).toString('base64'),
                branch: branch
            })
        }

        // student repo actions
        console.log(`Adding actions for student repo, ${`${username}-${cube}-cube`}, ${branch} branch...`);
        for (let idx = 0; idx < studentFiles.length; idx++) {
            const _file = studentFiles[idx];
            console.log(_file);
            let d = (await octokit.repos.getContents({
                owner: qHub,
                repo: actionsRepo,
                path: _file,
                ref: cubeType // "master"
            })).data;
            let content = Buffer.from(d.content, 'base64').toString('ascii');
            if(_file.endsWith(".yaml"))
                content = content.replace(/BRANCH/g, branch);
            await stdOctokit.repos.createOrUpdateFile({
                owner: username,
                repo: `${username}-${cube}-cube`,
                path: ".github/workflows/" + _file,
                message: "initial commit",
                content: Buffer.from(content).toString('base64'),
                branch: branch
            })
        }
        console.log("Done.");
    } catch (err) {
        console.log(err)
    }

}

async function checkLessonsPassed(owner, repo, path, ref, server, studentUsername, token){
    console.log("Check if all testes has been passed...");
    try {
        let hasPendingLesson = false;
        let octokit = new Octokit({
            auth: "token " + token
        });
        let res = await octokit.repos.getContents({
            owner,
            repo,
            path,
            ref
        });
        let cubeInfo = JSON.parse(Buffer.from(res.data.content, 'base64').toString('ascii'));
        console.log(cubeInfo)
        let cubeLessons = cubeInfo.result;
        let _key = Object.keys(cubeLessons);
        for (let idx = 0; idx < _key.length; idx++) {
            const l = cubeLessons[_key[idx]];
            console.log(l)
            if (l['test'] === 'pending') {
                hasPendingLesson = true;
            }
        }
        if (!hasPendingLesson) {
            // notify trainer
            console.log(`Notify KidoCode and teacher that student completed all lessons...`);
            await axios.post(server + "/api/notify", {
                "username": studentUsername,
                "repoLink": `https://github.com/${repo}`,
                "receiver": "nasrin@kidocode.com"
            });
            console.log("Done.");
        }

        console.log("Done.")
        return {
            result: true,
        }
        
    } catch (err) {
        throw err
    }
}

async function updateCube(cHub, qHub, repo, gitToken, branch) {
    console.log("Get token and pull new lesson...");

    const KIDOCODE = 'kportal-hub';
    const algorithm = 'aes256';
    const authPhrase = 'unclecode';
    const server = "https://cubie.now.sh";
    const _silent = false;
    const qHubActionRepo = 'qhub-actions';

    try {
        // const username = repo.split('/')[0];
        const studentRepoName = repo.split('/')[1];
        const studentUsername = studentRepoName.split('-')[0];
        const cubeName = studentRepoName.split('-')[1];
        const qHubCube = `${cubeName}-qhub`; // `${cubeName}-qhub-test`

        if(await getContent(cHub, repo.split('/')[1], "auth-request", branch, gitToken)){
            await encryptAndPutAuthFile(cHub, repo, algorithm, gitToken, authPhrase, _silent);
            let authRes = (await axios.post(server + "/api/check-auth", {
                username: studentUsername,
                gitToken,
                repo: studentRepoName,
                path: `auth`,
                type: "c"
            })).data
    
            if (!authRes.result) {
                console.log("Delete auth file...");
                try{
                    await deleteFile(
                        cHub,
                        repo.split('/')[1],
                        "auth",
                        "delete auth file",
                        "master",
                        gitToken
                    )
                } catch(err){
                    console.log("Could not delete auth file...");
                    console.log(err)
                }
                return false;
            } else {
    
                let r = await getUserTokenAndDecrypt(repo, algorithm, gitToken);
                const studentToken = r.split('\n')[0].split('=')[1]
                const masterToken = r.split('\n')[1].split('=')[1]
    
                // get next lesson name from qHub
                let res = await fetchLesson(cubeName, KIDOCODE, qHubCube, masterToken);
                let lessons = res.lessons;
                let nextLessonIndex = lessons.indexOf(branch) + 1;
                let lessonBranch = lessons[nextLessonIndex];
                
                let isDone = !lessonBranch ? true : false;
    
                // if (lessonBranch) {
                // then bring down next lessen from qhub with masterToken
                await pullNextLessonIntoChub(cubeName, branch, lessonBranch, masterToken, qHub, qHubCube, cHub, repo, _silent, isDone);
                
                // put new branch into student repo with his/her own token 
                await pullNextLessonIntoStudentRepo(cHub, studentUsername, studentRepoName, cubeName, branch, lessonBranch, masterToken, repo, studentToken, _silent, isDone);
                
                if (lessonBranch) {
                    // add actions file for chub and student repo
                    // await addActions(lessonBranch, studentUsername, cubeName, masterToken, studentToken, cHub, qHub, qHubCube);
                    await addActions(
                        res.cubeInfo.type, // cube type
                        qHubActionRepo,
                        lessonBranch,
                        studentUsername,
                        cubeName,
                        masterToken,
                        studentToken,
                        cHub,
                        qHub
                    );
                } else {
                    console.log("All the lessons have been completed");
                }
    
                await deleteFile(
                    cHub,
                    repo.split('/')[1],
                    "auth-request",
                    "delete auth file",
                    branch,
                    masterToken
                )
                await deleteFile(
                    cHub,
                    repo.split('/')[1],
                    "auth",
                    "delete auth file",
                    "master",
                    masterToken
                )

                // check if all the lessons completed and passed the tests
                await checkLessonsPassed(
                    qHub, // owner
                    studentRepoName, // repo
                    `${cubeName}.cube.json`, // path
                    "master", // ref
                    server,
                    studentUsername,
                    gitToken
                )
                
                console.log("Done");
            }
        }

    } catch (err) {
        console.log(err)
        throw err
    }
}

const pullNextLessonAndNotify = async (repo, gitToken, branch) => {
    const cHub = "kportal-hub";
    const qHub = "kportal-hub";
    return await updateCube(cHub, qHub, repo, gitToken, branch)
}

pullNextLessonAndNotify(process.argv[2], process.argv[3], process.argv[4]).then((res) => {
    console.log(res)
})
