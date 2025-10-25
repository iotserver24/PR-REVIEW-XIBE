import fetch from 'node-fetch';

// Simulate a real GitHub webhook payload for issue_comment event
const webhookPayload = {
  action: 'created',
  issue: {
    number: 1,
    pull_request: {
      url: 'https://api.github.com/repos/iotserver24/docs/pulls/1'
    }
  },
  comment: {
    id: 3444150964,
    body: '@Xibe-review please review this PR',
    user: {
      login: 'iotserver24'
    }
  },
  repository: {
    name: 'docs',
    full_name: 'iotserver24/docs',
    owner: {
      login: 'iotserver24'
    }
  },
  installation: {
    id: 90988524  // This will be automatically provided by GitHub
  }
};

async function testWebhook() {
  try {
    console.log('🧪 Testing GitHub Webhook');
    console.log('========================');
    console.log('📋 Webhook Details:');
    console.log(`   Repository: ${webhookPayload.repository.full_name}`);
    console.log(`   PR Number: #${webhookPayload.issue.number}`);
    console.log(`   Installation ID: ${webhookPayload.installation.id}`);
    console.log(`   Comment: "${webhookPayload.comment.body}"`);
    console.log('');
    console.log('🌐 How GitHub Calls Your Webhook:');
    console.log('   Method: POST');
    console.log('   URL: https://your-domain.com/webhook');
    console.log('   Headers:');
    console.log('     X-GitHub-Event: issue_comment');
    console.log('     X-GitHub-Delivery: unique-delivery-id');
    console.log('     User-Agent: GitHub-Hookshot/...');
    console.log('     Content-Type: application/json');
    console.log('   Body: JSON payload with installation.id');
    console.log('');

    console.log('📤 Sending webhook to bot...');
    
    const response = await fetch('http://localhost:3000/webhook', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-GitHub-Event': 'issue_comment',
        'X-GitHub-Delivery': 'test-delivery-id',
        'User-Agent': 'GitHub-Hookshot/test'
      },
      body: JSON.stringify(webhookPayload)
    });

    const responseText = await response.text();
    
    console.log(`📥 Response Status: ${response.status}`);
    console.log(`📥 Response Body: ${responseText}`);
    
    if (response.ok) {
      console.log('✅ Webhook received successfully!');
      console.log('');
      console.log('🤖 Bot should now:');
      console.log('   • Add 👀 reaction to the comment');
      console.log('   • Fetch PR details from GitHub');
      console.log('   • Generate AI review');
      console.log('   • Post review comment with [bot] badge');
    } else {
      console.log('❌ Webhook failed');
    }
    
  } catch (error) {
    console.error('❌ Error:', error.message);
  }
}

testWebhook();
