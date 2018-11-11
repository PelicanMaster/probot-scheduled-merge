const scheduler = require('node-schedule'),
	  yaml 		= require('js-yaml');

const defaultConfig 	 = { cron: '* * * * * 7' },
	  POSITIVE_REACTIONS = ['+1'],
	  NEGATIVE_REACTIONS = ['-1'];

let repositories = [];

async function getConfig (repository, authenticator) {
	let config = null,
		api = await authenticator();

	try {
		let configFile = await api.repos.getContent({
			repo: repository.name,
			owner: repository.owner.login,
			path: '.github/scheduled-merge.yml'
	    });

		if (configFile) {
			let content = Buffer.from(configFile.data.content, 'base64');
			config = yaml.safeLoad(content.toString());
		}
	} catch (error) {
		if (error.code != 404) {
			throw error;
		}
	}

	return config || defaultConfig;
}

async function addRepository (repository, authenticator) {
	let config = await getConfig(repository, authenticator),
		schedule = scheduler.scheduleJob(config.cron, () => executeSchedule(repository, authenticator));

	repositories.push({ repository, schedule });
}

function removeRepository (repository) {
	let index = repositories.findIndex(r => r.repository.id === repository.id);

	if (index > -1) {
		repositories[index].schedule.cancel();
		repositories.splice(index, 1);
	}
}

async function executeSchedule (repository, authenticator) {
	console.log(`[${new Date()}] Running on ${repository.name}...`);
	let api = await authenticator(),
		pullRequests = await api.pullRequests.getAll({
			repo: repository.name,
			owner: repository.owner.login,
			state: 'open'
		});

	if (pullRequests.data && pullRequests.data.length > 0) {
		let scores = [];

		for (let pullRequest of pullRequests.data) {
			let reactions = await api.reactions.getForIssue({
				repo: repository.name,
				owner: repository.owner.login,
				number: pullRequest.number
			});

			let score = reactions.data.reduce((total, reaction) => {
				if (POSITIVE_REACTIONS.includes(reaction.content)) {
					return total + 1;
				} else if (NEGATIVE_REACTIONS.includes(reaction.content)) {
					return total - 1;
				}

				return total;
			}, 0);

			for (let reaction of reactions.data) {
				await api.reactions.delete({
					reaction_id: reaction.id,
					headers: {
						accept: 'application/vnd.github.squirrel-girl-preview+json'
					}
				});
			}

			scores.push({ pullRequest, score });
		};

		scores.sort((a, b) => a.score - b.score);

		console.log(`[${new Date()}]\tSorted pull requests to : `, scores.map(p => ({ id: p.pullRequest.id, score: p.score })));

		let pullRequestToMerge = scores.pop().pullRequest;
		console.log(`[${new Date()}]\tMerging PR #${pullRequestToMerge.number}...`);
		await api.pullRequests.merge({
			repo: repository.name,
			owner: repository.owner.login,
			number: pullRequestToMerge.number
		});

		for (let score of scores) {
			console.log(`[${new Date()}]\tClosing PR #${score.pullRequest.number}...`);
			await api.pullRequests.update({
				repo: repository.name,
				owner: repository.owner.login,
				number: score.pullRequest.number,
				state: 'closed'
			});
		}
	}

	console.log(`[${new Date()}]\tEnded running on ${repository.name}.`);
}

async function getAuthenticatedAPI (installationId, robot) {
	return robot.auth(installationId);
}

module.exports = async robot => {
	console.log(`Probot-cron started`);
	let github = await robot.auth();

	console.log(`Adding 'installation' hook...`);
	robot.on('installation.created', context => {
		context.payload.repositories.forEach(repository => addRepository(repository, () => getAuthenticatedAPI(context.installation.id, robot)));
	});

	robot.on('installation.deleted', context => {
		context.payload.repositories.forEach(repository => removeRepository(repository));
	});

	console.log(`Rescheduling on older installations...`);
	let { data } = await github.apps.getInstallations();

	data.forEach(async ({ id }) => {
		let installation = await robot.auth(id),
			{ data } = await installation.apps.getInstallationRepositories();

		data.repositories.forEach(repository => addRepository(repository, () => getAuthenticatedAPI(id, robot)));
	});
}
