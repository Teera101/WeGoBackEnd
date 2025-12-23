import mongoose from 'mongoose';
import dotenv from 'dotenv';
import Activity from '../models/activity.js';
import Group from '../models/group.js';
import Chat from '../models/chat.js';
import User from '../models/user.js';
import Review from '../models/review.js';

dotenv.config();

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb+srv://moragon:7EV5I83WZQCs9H7t@cluster0.msj0omg.mongodb.net/WeGo';

async function seedTestData() {
  try {
    console.log('🔌 Connecting to MongoDB...');
    await mongoose.connect(MONGODB_URI);
    console.log('✅ Connected to MongoDB');

    // Find an existing user (or use a specific user ID)
    const users = await User.find().limit(3);
    if (users.length === 0) {
      console.log('❌ No users found. Please create users first.');
      process.exit(1);
    }

    const creator = users[0];
    console.log(`👤 Using user: ${creator.email} (${creator._id})`);

    // Create test activities
    const activities = [];
    const activityData = [
      {
        title: 'ทัวร์ชมดอกไม้ที่เชียงใหม่',
        description: 'สัมผัสความสวยงามของดอกไม้นานาพันธุ์ในเชียงใหม่ เที่ยวชมสวนดอกไม้และถ่ายรูปสวยๆ',
        tags: ['nature', 'photography', 'travel'],
        location: { address: 'Chiang Mai, Thailand', coordinates: { type: 'Point', coordinates: [98.9853, 18.7883] } },
        date: new Date('2025-11-01'),
        time: '09:00',
        endTime: '17:00',
        maxParticipants: 20
      },
      {
        title: 'กินข้าวเย็นที่ร้านอาหารญี่ปุ่น',
        description: 'มาชิมอาหารญี่ปุ่นรสชาติดีที่ร้านมิชลินสตาร์ ราคาสบายกระเป๋า',
        tags: ['japanese', 'dining', 'social'],
        location: { address: 'Bangkok, Thailand', coordinates: { type: 'Point', coordinates: [100.5018, 13.7563] } },
        date: new Date('2025-10-25'),
        time: '18:00',
        endTime: '21:00',
        maxParticipants: 8
      },
      {
        title: 'เดินป่าเขาใหญ่',
        description: 'เดินป่าชมธรรมชาติและน้ำตกที่อุทยานแห่งชาติเขาใหญ่',
        tags: ['hiking', 'nature', 'adventure'],
        location: { address: 'Khao Yai National Park', coordinates: { type: 'Point', coordinates: [101.3715, 14.4344] } },
        date: new Date('2025-11-15'),
        time: '06:00',
        endTime: '18:00',
        maxParticipants: 15
      }
    ];

    console.log('🎯 Creating test activities...');
    for (const data of activityData) {
      const activity = new Activity({
        ...data,
        createdBy: creator._id,
        participants: [{ user: creator._id, status: 'joined' }],
        status: 'published',
        visibility: 'public'
      });
      await activity.save();
      activities.push(activity);
      console.log(`✅ Created activity: ${activity.title} (${activity._id})`);
    }

    // Create groups linked to activities
    console.log('\n👥 Creating groups linked to activities...');
    const groups = [];
    for (let i = 0; i < activities.length; i++) {
      const activity = activities[i];
      const group = new Group({
        name: `Group for: ${activity.title}`,
        owner: creator._id,
        members: [creator._id],
        isPrivate: false
      });
      await group.save();
      groups.push(group);
      console.log(`✅ Created group: ${group.name} (${group._id})`);

      // Create a chat for the group
      const chat = new Chat({
        type: 'group',
        createdBy: creator._id,
        participants: [{ user: creator._id, role: 'admin' }],
        groupInfo: {
          relatedActivity: activity._id,
          groupName: group.name
        },
        messages: []
      });
      await chat.save();
      console.log(`✅ Created chat: ${chat._id}`);
    }

    // Add some sample reviews
    console.log('\n⭐ Creating sample reviews...');
    for (let i = 0; i < Math.min(2, activities.length); i++) {
      const activity = activities[i];
      
      // Add reviews from different users
      for (let j = 0; j < Math.min(users.length, 3); j++) {
        const review = new Review({
          groupId: activity._id, // Using groupId for activity reviews
          userId: users[j]._id,
          rating: Math.floor(Math.random() * 2) + 4, // 4-5 stars
          comment: [
            'สนุกมากครับ! แนะนำเลย',
            'กิจกรรมดีมาก บรรยากาศสบายๆ',
            'ชอบมากค่ะ จะมาอีกแน่นอน',
            'ประทับใจการบริการและความเป็นมิตร',
            'คุ้มค่าเงินที่จ่ายไปมาก'
          ][j % 5]
        });
        await review.save();
        console.log(`✅ Created review for ${activity.title} by ${users[j].email}`);
      }
    }

    console.log('\n🎉 Test data seeded successfully!');
    console.log('\n📋 Summary:');
    console.log(`   Activities: ${activities.length}`);
    console.log(`   Groups: ${groups.length}`);
    console.log(`   Chats: ${groups.length}`);
    console.log('\n🔗 Activity IDs:');
    activities.forEach(a => console.log(`   ${a.title}: ${a._id}`));
    
    console.log('\n✨ You can now test reviews and reports!');
    
  } catch (error) {
    console.error('❌ Error seeding data:', error);
  } finally {
    await mongoose.disconnect();
    console.log('\n👋 Disconnected from MongoDB');
    process.exit(0);
  }
}

seedTestData();
