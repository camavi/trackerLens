const tlConfig = {
  WEB_URL: 'https://trackerslens.com',
  SERVER_URL: 'https://api.trackerslens.com/v1/',
  API_BASE_URL: 'https://api.trackerslens.com',
  API_LOCAL_URL: 'http://127.0.0.1:8000',
  API_KEY: 'YOUR_API_KEY',
  VERSION: '0.0.1',
  DB_NAME: 'TrackersLens',
  TABLES: {
    TL_PAGES: 'tl_pages',
    TL_WIDGETS: 'tl_widgets',
    TL_CONNECTIONS: 'tl_connections',
    TL_SETTINGS: 'tl_settings',
    TL_AI_PROVIDERS: 'tl_ai_providers',
    TL_AI_AGENTS: 'tl_ai_agents',
    TL_AI_RUNTIME: 'tl_ai_runtime',
    TL_AI_JOBS: 'tl_ai_jobs',
    TL_AI_LOGS: 'tl_ai_logs',
    TL_AI_MEMORY: 'tl_ai_memory',
    TL_AI_PROMPTS: 'tl_ai_prompts',
    TL_AI_PROMPT_FLOWS: 'tl_ai_prompt_flows',
    TL_AI_METRICS: 'tl_ai_metrics',
    TL_KNOWLEDGE_DOCUMENTS: 'tl_knowledge_documents',
    TL_KNOWLEDGE_CHUNKS: 'tl_knowledge_chunks',
    TL_KNOWLEDGE_EMBEDDINGS: 'tl_knowledge_embeddings',
    TL_KNOWLEDGE_ENTITIES: 'tl_knowledge_entities',
    TL_KNOWLEDGE_RELATIONS: 'tl_knowledge_relations',
    TL_KNOWLEDGE_QUERIES: 'tl_knowledge_queries',
    TL_KNOWLEDGE_SOURCES: 'tl_knowledge_sources',
    TL_KNOWLEDGE_METRICS: 'tl_knowledge_metrics',
    TL_CHANNELS: 'tl_channels',
    TL_FLOWS: 'tl_flows',
    TL_EVENTS: 'tl_events',
    TL_FLOW_LOGS: 'tl_flow_logs',
    TL_FLOW_PROMPT_CHATS: 'tl_flow_prompt_chats',
    TL_AGENTS: 'tl_agents',
    TL_RUNTIME_NODES: 'tl_runtime_nodes',
    TL_RUNTIME_DEPENDENCIES: 'tl_runtime_dependencies',
    TL_BOX_PERFORMANCE: 'tl_box_performance',
    TL_OFFLINE_QUEUE: 'tl_offline_queue',
    TL_OFFLINE_CACHE: 'tl_offline_cache',
    TL_PACKAGES: 'tl_packages',
    TL_PACKAGE_LOCK: 'tl_package_lock',
    TL_TIME_TRAVEL_SNAPSHOTS: 'tl_time_travel_snapshots'
  },

  MANIFEST: [
    {
      label: 'Name',
      type: 'text',
      name: 'name',
    },
    {
      label: 'Version',
      type: 'text',
      name: 'version',
    },
    {
      label: 'Author',
      type: 'text',
      name: 'author',
    },
    {
      label: 'Icon link',
      type: 'text',
      name: 'icon',
    },
    {
      label: 'Default language',
      type: 'text',
      name: 'default_language',
    },
    {
      label: 'Description',
      type: 'textarea',
      name: 'description',
    }
  ],
  SETTING_DEFAULT_WIDGET: {
    deviceSupport: {
      mobile: true,
      table: true,
      desktop: true,
    },
    type: '',
    minX: 3,
    maxX: 6,
    minY: 2,
    maxY: 4,
  },
  CATEGORIES: [
    {
      "category": "All",
      "widgets": [
        {
          "name": "All",
          "key": "all",
          "description": "All types."
        }
      ]
    },
    {
      "category": "Content and Text",
      "widgets": [
        {
          "name": "Dynamic Texts",
          "key": "dynamic_texts",
          "description": "Dynamic texts like news tickers or random quotes."
        },
        {
          "name": "Text Editor",
          "key": "text_editor",
          "description": "A customizable text editor supporting markdown and rich text."
        },
        {
          "name": "Event Calendar",
          "key": "event_calendar",
          "description": "Displays events in a calendar format."
        },
        {
          "name": "FAQ Accordion",
          "key": "faq_accordion",
          "description": "Collapsible FAQ sections for organizing information."
        },
        {
          "name": "Blog Excerpt",
          "key": "blog_excerpt",
          "description": "Previews of blog articles with titles and summaries."
        }
      ]
    },
    {
      "category": "Navigation",
      "widgets": [
        {
          "name": "Navigation Bars",
          "key": "navigation_bars",
          "description": "Horizontal menus or hamburger-style navigation."
        },
        {
          "name": "Breadcrumbs",
          "key": "breadcrumbs",
          "description": "Displays a navigational path to improve UX."
        },
        {
          "name": "Search Box",
          "key": "search_box",
          "description": "A customizable search box for site navigation."
        },
        {
          "name": "Interactive Sidebar",
          "key": "interactive_sidebar",
          "description": "An expandable or collapsible sidebar for additional navigation."
        }
      ]
    },
    {
      "category": "Media",
      "widgets": [
        {
          "name": "Image Galleries",
          "key": "image_galleries",
          "description": "Displays images as sliders or lightboxes."
        },
        {
          "name": "Media Player",
          "key": "media_player",
          "description": "Plays audio or video files with customizable controls."
        },
        {
          "name": "Interactive Maps",
          "key": "interactive_maps",
          "description": "Maps with markers and dynamic zoom capabilities."
        }
      ]
    },
    {
      "category": "User Interaction",
      "widgets": [
        {
          "name": "Contact Form",
          "key": "contact_form",
          "description": "A form for users to send messages or inquiries."
        },
        {
          "name": "Feedback Form",
          "key": "feedback_form",
          "description": "A form for collecting user feedback."
        },
        {
          "name": "Chat Widget",
          "key": "chat_widget",
          "description": "Integrates live chat or chatbot functionality."
        },
        {
          "name": "Custom Notifications",
          "key": "custom_notifications",
          "description": "Displays personalized notifications to users."
        }
      ]
    },
    {
      "category": "Charts and Data",
      "widgets": [
        {
          "name": "Charts and Graphs",
          "key": "charts_graphs",
          "description": "Displays visual data like pie charts, bar graphs, or line charts."
        },
        {
          "name": "Interactive Data Tables",
          "key": "interactive_data_tables",
          "description": "Displays data in sortable and interactive tables."
        },
        {
          "name": "Finance Widget",
          "key": "finance_widget",
          "description": "Displays data for currencies and cryptocurrencies."
        }
      ]
    },
    {
      "category": "Utilities",
      "widgets": [
        {
          "name": "Counters",
          "key": "counters",
          "description": "Includes timers, countdowns, or view counters."
        },
        {
          "name": "Progress Bar",
          "key": "progress_bar",
          "description": "Shows progress in tasks or goals."
        },
        {
          "name": "To-Do List",
          "key": "to_do_list",
          "description": "Allows users to create and manage task lists."
        },
        {
          "name": "Weather Widget",
          "key": "weather_widget",
          "description": "Displays current weather and forecasts."
        }
      ]
    },
    {
      "category": "Social and Community",
      "widgets": [
        {
          "name": "Social Media Buttons",
          "key": "social_media_buttons",
          "description": "Includes buttons for sharing or following on social platforms."
        },
        {
          "name": "Social Feeds",
          "key": "social_feeds",
          "description": "Displays content feeds from Instagram, Twitter, or Facebook."
        },
        {
          "name": "Reviews and Ratings",
          "key": "reviews_ratings",
          "description": "Displays user reviews and ratings for products or services."
        }
      ]
    },
    {
      "category": "E-commerce",
      "widgets": [
        {
          "name": "Shopping Cart",
          "key": "shopping_cart",
          "description": "Allows users to manage items for purchase."
        },
        {
          "name": "Product Reviews",
          "key": "product_reviews",
          "description": "Displays reviews for specific products."
        },
        {
          "name": "Product Search Widget",
          "key": "product_search_widget",
          "description": "Search functionality for finding products."
        }
      ]
    },
    {
      "category": "UI Customization",
      "widgets": [
        {
          "name": "Dynamic Themes",
          "key": "dynamic_themes",
          "description": "Allows users to switch between themes and layouts."
        },
        {
          "name": "Customizable Modals",
          "key": "customizable_modals",
          "description": "Displays custom modal dialogs or popups."
        },
        {
          "name": "Interactive Tabs",
          "key": "interactive_tabs",
          "description": "Switchable tabs for organizing content."
        }
      ]
    },
    {
      "category": "Integrations and APIs",
      "widgets": [
        {
          "name": "Custom API Widgets",
          "key": "custom_api_widgets",
          "description": "Integrates external APIs to display customized data."
        },
        {
          "name": "Google Analytics Widget",
          "key": "google_analytics_widget",
          "description": "Tracks user activity and metrics using Google Analytics."
        },
        {
          "name": "Developer Tools",
          "key": "developer_tools",
          "description": "Provides tools for debugging and development."
        }
      ]
    },
    {
      "category": "Security and Privacy",
      "widgets": [
        {
          "name": "Two-Factor Authentication",
          "key": "two_factor_authentication",
          "description": "Adds security measures for users by requiring two-factor authentication."
        },
        {
          "name": "User Data Privacy",
          "key": "user_data_privacy",
          "description": "Guarantees that user data is handled securely and in compliance with privacy regulations."
        },
        {
          "name": "Cookie Settings",
          "key": "cookie_settings",
          "description": "Displays and manages user cookie settings."
        }
      ]
    },
    {
      "category": "SEO and Search Optimization",
      "widgets": [
        {
          "name": "SEO Tools",
          "key": "seo_tools",
          "description": "Provides tools for optimizing site content for search engines."
        },
        {
          "name": "Search Engine Marketing",
          "key": "search_engine_marketing",
          "description": "Enhances website visibility by using search engine optimization techniques."
        },
        {
          "name": "Keyword Research",
          "key": "keyword_research",
          "description": "Identifies keywords that users might search for on your site."
        }
      ]
    },
    {
      "category": "Business and Marketing",
      "widgets": [
        {
          "name": "Real-Time Exchange Rates",
          "key": "realtime_exchange_rates",
          "description": "Displays up-to-date exchange rates for cryptocurrencies and fiat currencies."
        },
        {
          "name": "Price Charts",
          "key": "price_charts",
          "description": "Interactive charts to monitor price trends (candlestick, linear, bar)."
        },
        {
          "name": "Financial News Feed",
          "key": "financial_news_feed",
          "description": "Shows the latest news on the financial market and cryptocurrencies."
        },
        {
          "name": "Currency Converter",
          "key": "currency_converter",
          "description": "A tool for converting cryptocurrencies and fiat currencies."
        },
        {
          "name": "Portfolio Tracker",
          "key": "portfolio_tracker",
          "description": "Tracks portfolio performance, including profits and losses."
        },
        {
          "name": "Top Cryptocurrencies",
          "key": "top_cryptocurrencies",
          "description": "A list of top cryptocurrencies sorted by market cap, volume, or other metrics."
        },
        {
          "name": "Stock Ticker",
          "key": "stock_ticker",
          "description": "Displays real-time values of indices and specific stocks."
        },
        {
          "name": "Price Alerts",
          "key": "price_alerts",
          "description": "Notifies users when predefined price thresholds are reached."
        },
        {
          "name": "Staking Widget",
          "key": "staking_widget",
          "description": "Displays earnings from staking cryptocurrencies."
        },
        {
          "name": "Mining Calculator",
          "key": "mining_calculator",
          "description": "Estimates profits based on hash rate, energy consumption, and other factors."
        },
        {
          "name": "Market Sentiment Index",
          "key": "market_sentiment_index",
          "description": "Shows the market's fear and greed index to assess investor sentiment."
        },
        {
          "name": "Market Hours",
          "key": "market_hours",
          "description": "Indicates the opening and closing times of major global stock markets."
        },
        {
          "name": "Transaction Details",
          "key": "transaction_details",
          "description": "Displays transaction volumes and details on exchanges and wallets."
        },
        {
          "name": "Market Heatmap",
          "key": "market_heatmap",
          "description": "A graphical representation of market performance using color codes."
        },
        {
          "name": "Exchange List",
          "key": "exchange_list",
          "description": "A list of major exchanges with details on fees and ratings."
        }
      ]

    },
    {
      "category": "NFTs",
      "widgets": [
        {
          "name": "NFT Showcase",
          "key": "nft_showcase",
          "description": "Displays a gallery of NFTs with metadata and previews."
        },
        {
          "name": "NFT Market Tracker",
          "key": "nft_market_tracker",
          "description": "Tracks the latest trends and prices in NFT markets."
        },
        {
          "name": "NFT Wallet Integration",
          "key": "nft_wallet_integration",
          "description": "Connects to users' wallets to display owned NFTs."
        },
        {
          "name": "NFT Minting Widget",
          "key": "nft_minting_widget",
          "description": "Enables users to mint their own NFTs directly from the platform."
        },
        {
          "name": "NFT Auction Timer",
          "key": "nft_auction_timer",
          "description": "Displays countdowns for NFT auctions or sales."
        }
      ]
    },
    {
      "category": "Advertising",
      "widgets": [
        {
          "name": "Display ads",
          "key": "display_ads",
          "type": "Display Ads",
          "description": "Static image or animated banners, often placed at the top, side, or bottom of a webpage."
        },
        {
          "name": "Video ads",
          "key": "video_ads",
          "type": "Video Ads",
          "description": "Video-based advertisements that play before, during, or after a content item, such as a video or article."
        },
        {
          "name": "Interstitial ads",
          "key": "interstitial_ads",
          "type": "Interstitial Ads",
          "description": "Full-page ads that appear when transitioning between pages or activities, often used to grab attention."
        },
        {
          "name": "Native ads",
          "key": "native_ads",
          "type": "Native Ads",
          "description": "Ads designed to blend seamlessly with webpage content, typically appearing as recommendations or sponsored posts."
        },
        {
          "name": "Pop up ads",
          "key": "pop_up_ads",
          "type": "Pop-Up Ads",
          "description": "Ads that open in a new window or tab, typically triggered by a user action, such as clicking a button or scrolling."
        },
        {
          "name": "Retargeting ads",
          "key": "retargeting_ads",
          "type": "Retargeting Ads",
          "description": "Ads targeted to users who have previously visited your site or interacted with your brand but did not convert into customers."
        },
        {
          "name": "Affiliate ads",
          "key": "affiliate_ads",
          "type": "Affiliate Ads",
          "description": "Ads promoting third-party products or services, earning a commission for each sale or action generated through the ad."
        },
        {
          "name": "Social media ads",
          "key": "social_media_ads",
          "type": "Social Media Ads",
          "description": "Ads placed on social media platforms like Facebook, Instagram, or Twitter, targeted to specific audiences."
        },
        {
          "name": "Sponsored content",
          "key": "sponsored_content",
          "type": "Sponsored Content",
          "description": "Content that appears to be a regular part of the site's content but is sponsored by an advertiser, often used for brand promotion."
        },
        {
          "name": "Email ads",
          "key": "email_ads",
          "type": "Email Ads",
          "description": "Ads sent directly to users' inboxes, typically in the form of newsletters or promotional offers."
        },
        {
          "name": "Text ads",
          "key": "text_ads",
          "type": "Text Ads",
          "description": "Simple text-based ads, typically short and concise, that can be placed in articles or search results."
        },
        {
          "name": "Banner_rotator ads",
          "key": "banner_rotator_ads",
          "type": "Banner Rotator Ads",
          "description": "A rotating set of banners that changes periodically, often used for multiple ad campaigns."
        },
        {
          "name": "Rich_media ads",
          "key": "rich_media_ads",
          "type": "Rich Media Ads",
          "description": "Interactive ads that may include animations, videos, or elements that users can engage with."
        },
        {
          "name": "In app ads",
          "key": "in_app_ads",
          "type": "In-App Ads",
          "description": "Ads shown within mobile or desktop applications, typically in the form of banners, interstitials, or videos."
        },
        {
          "name": "Popup video ads",
          "key": "popup_video_ads",
          "type": "Popup Video Ads",
          "description": "Small video ads that pop up in a new window, often used in apps or games to incentivize engagement."
        },
        {
          "name": "Pre roll ads",
          "key": "pre_roll_ads",
          "type": "Pre-Roll Ads",
          "description": "Ads that play before a video or other content, typically short and skippable after a few seconds."
        },
        {
          "name": "Post roll ads",
          "key": "post_roll_ads",
          "type": "Post-Roll Ads",
          "description": "Ads that play after the main content has finished, typically used in videos."
        },
        {
          "name": "Side ads",
          "key": "side_ads",
          "type": "Side Ads",
          "description": "Vertical banners or ads placed on the side of the webpage, usually appearing in a less intrusive manner."
        }
      ]
    }

  ]

}
