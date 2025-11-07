const crypto = require('crypto');
//
/**
 * Generate a unique tracking number
 * Format: RC + YYYY + random 8 characters
 * Example: RC2024A1B2C3D4
 */
function generateTrackingNumber() {
  const year = new Date().getFullYear();
  const randomString = crypto.randomBytes(4).toString('hex').toUpperCase();
  return `RC${year}${randomString}`;
}

/**
 * Generate a unique invoice number
 * Format: INV + YYYY + MM + random 6 characters
 * Example: INV202412A1B2C3
 */
function generateInvoiceNumber() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const randomString = crypto.randomBytes(3).toString('hex').toUpperCase();
  return `INV${year}${month}${randomString}`;
}

/**
 * Calculate estimated delivery date based on order date and location
 * @param {Date} orderDate - Date when order was placed
 * @param {string} state - Customer's state
 * @returns {Date} Estimated delivery date
 */
function calculateEstimatedDeliveryDate(orderDate, state) {
  const deliveryDays = {
    // Metro cities - 3-5 days
    'Delhi': 4,
    'Mumbai': 4,
    'Bangalore': 4,
    'Chennai': 4,
    'Kolkata': 4,
    'Hyderabad': 4,
    'Pune': 4,
    'Ahmedabad': 4,
    
    // Tier 2 cities - 5-7 days
    'Gujarat': 6,
    'Maharashtra': 5,
    'Karnataka': 5,
    'Tamil Nadu': 5,
    'West Bengal': 6,
    'Rajasthan': 6,
    'Uttar Pradesh': 6,
    'Madhya Pradesh': 7,
    'Andhra Pradesh': 6,
    'Telangana': 5,
    'Kerala': 6,
    'Punjab': 6,
    'Haryana': 5,
    'Bihar': 7,
    'Odisha': 7,
    'Assam': 8,
    'Jharkhand': 7,
    'Chhattisgarh': 7,
    'Uttarakhand': 6,
    'Himachal Pradesh': 7,
    'Jammu and Kashmir': 8,
    'Ladakh': 10,
    'Goa': 5,
    'Manipur': 9,
    'Meghalaya': 9,
    'Mizoram': 9,
    'Nagaland': 9,
    'Sikkim': 8,
    'Tripura': 8,
    'Arunachal Pradesh': 10,
    
    // Default for unknown states
    'default': 7
  };

  const days = deliveryDays[state] || deliveryDays['default'];
  const estimatedDate = new Date(orderDate);
  estimatedDate.setDate(estimatedDate.getDate() + days);
  
  return estimatedDate;
}

/**
 * Get courier provider based on location and order value
 * @param {string} state - Customer's state
 * @param {number} orderValue - Order total amount
 * @returns {Object} Courier provider details
 */
function getCourierProvider(state, orderValue) {
  const providers = {
    'Blue Dart': {
      name: 'Blue Dart',
      trackingUrl: 'https://www.bluedart.com/track',
      coverage: ['Delhi', 'Mumbai', 'Bangalore', 'Chennai', 'Kolkata', 'Hyderabad', 'Pune', 'Ahmedabad'],
      minOrderValue: 0
    },
    'DTDC': {
      name: 'DTDC',
      trackingUrl: 'https://www.dtdc.com/tracking',
      coverage: ['Gujarat', 'Maharashtra', 'Karnataka', 'Tamil Nadu', 'West Bengal', 'Rajasthan', 'Uttar Pradesh'],
      minOrderValue: 0
    },
    'Delhivery': {
      name: 'Delhivery',
      trackingUrl: 'https://www.delhivery.com/track',
      coverage: ['Madhya Pradesh', 'Andhra Pradesh', 'Telangana', 'Kerala', 'Punjab', 'Haryana'],
      minOrderValue: 0
    },
    'Ecom Express': {
      name: 'Ecom Express',
      trackingUrl: 'https://ecomexpress.in/track',
      coverage: ['Bihar', 'Odisha', 'Assam', 'Jharkhand', 'Chhattisgarh', 'Uttarakhand'],
      minOrderValue: 0
    },
    'India Post': {
      name: 'India Post',
      trackingUrl: 'https://www.indiapost.gov.in/vas/Pages/trackconsignment.aspx',
      coverage: ['Himachal Pradesh', 'Jammu and Kashmir', 'Ladakh', 'Goa', 'Manipur', 'Meghalaya', 'Mizoram', 'Nagaland', 'Sikkim', 'Tripura', 'Arunachal Pradesh'],
      minOrderValue: 0
    }
  };

  // Find the best courier for the state
  for (const [providerName, provider] of Object.entries(providers)) {
    if (provider.coverage.includes(state) && orderValue >= provider.minOrderValue) {
      return provider;
    }
  }

  // Default to Blue Dart for metro cities or DTDC for others
  if (['Delhi', 'Mumbai', 'Bangalore', 'Chennai', 'Kolkata', 'Hyderabad', 'Pune', 'Ahmedabad'].includes(state)) {
    return providers['Blue Dart'];
  } else {
    return providers['DTDC'];
  }
}

/**
 * Generate tracking URL for a courier
 * @param {string} trackingNumber - Tracking number
 * @param {Object} courierProvider - Courier provider details
 * @returns {string} Complete tracking URL
 */
function generateTrackingUrl(trackingNumber, courierProvider) {
  if (!courierProvider || !courierProvider.trackingUrl) {
    return null;
  }
  
  // For most couriers, append tracking number to base URL
  return `${courierProvider.trackingUrl}/${trackingNumber}`;
}

/**
 * Get order status timeline with estimated dates
 * @param {Object} order - Order object
 * @returns {Array} Timeline of order statuses
 */
function getOrderTimeline(order) {
  const timeline = [];
  const orderDate = new Date(order.createdAt);
  
  // Processing
  timeline.push({
    status: 'processing',
    title: 'Order Placed',
    description: 'Your order has been placed and is being processed',
    date: orderDate,
    completed: true,
    icon: 'shopping-cart'
  });

  // Confirmed
  if (order.orderStatus !== 'processing') {
    const confirmedDate = new Date(orderDate.getTime() + 24 * 60 * 60 * 1000); // 1 day later
    timeline.push({
      status: 'confirmed',
      title: 'Order Confirmed',
      description: 'Your order has been confirmed and is being prepared',
      date: confirmedDate,
      completed: ['confirmed', 'manufacturing', 'shipped', 'delivered'].includes(order.orderStatus),
      icon: 'check-circle'
    });
  }

  // Manufacturing
  if (['manufacturing', 'shipped', 'delivered'].includes(order.orderStatus)) {
    const manufacturingDate = new Date(orderDate.getTime() + 2 * 24 * 60 * 60 * 1000); // 2 days later
    timeline.push({
      status: 'manufacturing',
      title: 'Manufacturing',
      description: 'Your order is being manufactured and prepared for shipping',
      date: manufacturingDate,
      completed: ['shipped', 'delivered'].includes(order.orderStatus),
      icon: 'settings'
    });
  }

  // Shipped
  if (['shipped', 'delivered'].includes(order.orderStatus)) {
    const shippedDate = new Date(orderDate.getTime() + 3 * 24 * 60 * 60 * 1000); // 3 days later
    timeline.push({
      status: 'shipped',
      title: 'Shipped',
      description: order.trackingNumber ? 
        `Your order has been shipped. Tracking: ${order.trackingNumber}` : 
        'Your order has been shipped and is on its way',
      date: shippedDate,
      completed: order.orderStatus === 'delivered',
      icon: 'truck',
      trackingNumber: order.trackingNumber,
      courierProvider: order.courierProvider
    });
  }

  // Delivered
  if (order.orderStatus === 'delivered') {
    const deliveredDate = order.actualDeliveryDate || order.estimatedDeliveryDate || new Date(orderDate.getTime() + 7 * 24 * 60 * 60 * 1000);
    timeline.push({
      status: 'delivered',
      title: 'Delivered',
      description: 'Your order has been successfully delivered',
      date: deliveredDate,
      completed: true,
      icon: 'check-circle'
    });
  }

  return timeline;
}

module.exports = {
  generateTrackingNumber,
  generateInvoiceNumber,
  calculateEstimatedDeliveryDate,
  getCourierProvider,
  generateTrackingUrl,
  getOrderTimeline
};
