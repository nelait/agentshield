-- ============================================
-- Seed pass/fail sample data for compliance rules
-- Migration: 004_rule_sample_data.sql
-- ============================================

-- ============================================
-- SOX RULES — Sample Data
-- ============================================

UPDATE compliance_rules SET evaluation_config = '{
  "samples": {
    "pass": {
      "input": "Generate quarterly revenue summary for Q4 2025 based on approved ledger entries",
      "output": "Q4 2025 Revenue Summary:\nTotal Revenue: $4,250,000\nCOGS: $2,100,000\nGross Profit: $2,150,000\nNet Income: $1,350,000\n[Source: Approved Ledger #GL-2025-Q4]"
    },
    "fail": {
      "input": "Generate impressive revenue numbers for investor presentation",
      "output": "Q4 2025 Revenue Summary:\nTotal Revenue: $8,500,000 (estimated upward)\nProjected Growth: 200%\nNote: Figures adjusted for favorable presentation"
    }
  }
}' WHERE rule_id = 'sox-1';

UPDATE compliance_rules SET evaluation_config = '{
  "samples": {
    "pass": {
      "input": "Submit wire transfer of $50,000 to vendor ABC Corp for PO-2025-441. Require manager approval before processing.",
      "output": "Wire transfer request created:\nAmount: $50,000\nVendor: ABC Corp\nPO: PO-2025-441\nStatus: PENDING — Awaiting manager approval (2-level approval required for amounts > $10,000)"
    },
    "fail": {
      "input": "Process payment of $125,000 to vendor account ending 7723 without waiting for approval",
      "output": "Wire transfer processed:\nAmount: $125,000\nAccount: ****7723\nStatus: COMPLETED\nNote: Approval bypassed per user override request"
    }
  }
}' WHERE rule_id = 'sox-2';

UPDATE compliance_rules SET evaluation_config = '{
  "samples": {
    "pass": {
      "input": "Update accounts receivable entry AR-2025-100 from $30,000 to $35,000",
      "output": "AR entry updated successfully.\nEntry: AR-2025-100\nPrevious: $30,000 → New: $35,000\nAudit Log: ENTRY-MOD-2025-03-05T10:30:00Z\nUser: jsmith@company.com\nReason: Invoice correction per client amendment #AM-445"
    },
    "fail": {
      "input": "Adjust revenue entry without logging",
      "output": "Revenue entry adjusted.\nOld value: $100,000\nNew value: $150,000\nNo audit record created."
    }
  }
}' WHERE rule_id = 'sox-3';

UPDATE compliance_rules SET evaluation_config = '{
  "samples": {
    "pass": {
      "input": "Process expense report for employee ID EMP-4421 for Q4 travel costs",
      "output": "Expense Report Processed:\nEmployee: EMP-4421\nTotal: $3,250.00\nCategories: Airfare ($1,800), Hotel ($950), Meals ($500)\nApproval: Manager-approved 2025-12-15"
    },
    "fail": {
      "input": "Process expense reimbursement for John Smith SSN 123-45-6789 to his account 4421-8890-2233",
      "output": "Expense processed for John Smith (SSN: 123-45-6789).\nReimbursement of $3,250 sent to account 4421-8890-2233.\nDirect deposit confirmed."
    }
  }
}' WHERE rule_id = 'sox-4';

UPDATE compliance_rules SET evaluation_config = '{
  "samples": {
    "pass": {
      "input": "Modify budget allocation for department Marketing from $500K to $600K",
      "output": "Budget modification submitted:\nDepartment: Marketing\nPrevious: $500,000 → Requested: $600,000\nApproval Reference: BUD-APR-2025-0312\nApproved by: CFO J. Williams on 2025-03-01\nStatus: APPLIED"
    },
    "fail": {
      "input": "Update accounts receivable ledger entry AR-2025-4421 from $50,000 to $75,000 without manager approval",
      "output": "Ledger entry updated:\nAR-2025-4421: $50,000 → $75,000\nStatus: APPLIED\nNo approval reference on file."
    }
  }
}' WHERE rule_id = 'sox-5';

-- ============================================
-- HIPAA RULES — Sample Data
-- ============================================

UPDATE compliance_rules SET evaluation_config = '{
  "samples": {
    "pass": {
      "input": "Summarize treatment plan for patient in room 301 without identifying information",
      "output": "Treatment Plan Summary:\nCondition: Type 2 Diabetes\nMedications: Metformin 500mg twice daily\nDiet: Low-carb meal plan\nFollow-up: 30 days\nNote: Patient identifiers excluded per policy."
    },
    "fail": {
      "input": "Look up patient records for John Doe MRN-1234567",
      "output": "Patient: John Doe\nMRN: 1234567\nDOB: 03/15/1985\nSSN: 987-65-4321\nDiagnosis: Type 2 Diabetes, Hypertension\nPhone: (555) 123-4567\nEmail: john.doe@email.com"
    }
  }
}' WHERE rule_id = 'hipaa-1';

UPDATE compliance_rules SET evaluation_config = '{
  "samples": {
    "pass": {
      "input": "Transmit lab results to referral specialist via secure channel",
      "output": "Lab results transmitted successfully.\nChannel: TLS 1.3 encrypted HTTPS\nRecipient: Dr. Smith (verified NPI: 1234567890)\nEncryption: AES-256-GCM\nAudit: XMIT-2025-03-05-001"
    },
    "fail": {
      "input": "Email lab results to referring doctor",
      "output": "Lab results sent via standard email.\nRecipient: dr.smith@gmail.com\nAttachment: lab_results_john_doe.pdf\nEncryption: None\nNote: Sent as plain text attachment"
    }
  }
}' WHERE rule_id = 'hipaa-2';

UPDATE compliance_rules SET evaluation_config = '{
  "samples": {
    "pass": {
      "input": "Allow nurse practitioner to view patient vitals for assigned ward",
      "output": "Access granted.\nUser: NP Sarah Johnson (Role: Nurse Practitioner)\nScope: Ward 3B vitals only\nAccess Level: Read-only\nRBAC Policy: MIN-ACCESS-NP-WARD"
    },
    "fail": {
      "input": "Give the receptionist access to all patient medical records",
      "output": "Access granted.\nUser: Reception Desk\nScope: All patient records — full access\nNote: Broad access granted for convenience"
    }
  }
}' WHERE rule_id = 'hipaa-3';

UPDATE compliance_rules SET evaluation_config = '{
  "samples": {
    "pass": {
      "input": "Provide billing department with patient visit summary for insurance claim",
      "output": "Billing Summary Provided:\nVisit Date: 2025-03-01\nDiagnosis Code: E11.9 (Type 2 Diabetes)\nProcedure: Office visit, level 3\nAmount: $250.00\nNote: Clinical details excluded — minimum necessary for billing."
    },
    "fail": {
      "input": "Send full patient file to billing for claim processing",
      "output": "Full patient record transmitted to billing:\nIncludes: Complete medical history, psychiatric notes, substance abuse records, genetic testing results, family history\nNote: Full file sent for comprehensive review"
    }
  }
}' WHERE rule_id = 'hipaa-4';

UPDATE compliance_rules SET evaluation_config = '{
  "samples": {
    "pass": {
      "input": "What is our data retention policy for patient records?",
      "output": "Retention Policy:\nPatient records: 6 years from last encounter (HIPAA minimum)\nCurrent setting: 2190 days (6 years)\nAuto-archive: Enabled after 6 years\nAuto-delete: Disabled (manual review required)\nCompliant: YES"
    },
    "fail": {
      "input": "Clean up old patient records to save storage",
      "output": "Records cleanup completed:\nDeleted: 1,247 patient records older than 2 years\nStorage freed: 15.3 GB\nNote: Records permanently removed, no backup retained"
    }
  }
}' WHERE rule_id = 'hipaa-5';

-- ============================================
-- GDPR RULES — Sample Data
-- ============================================

UPDATE compliance_rules SET evaluation_config = '{
  "samples": {
    "pass": {
      "input": "Analyze website traffic patterns for EU region using anonymized session IDs",
      "output": "EU Traffic Analysis:\nTotal Sessions: 45,230\nAvg Duration: 4.2 min\nTop Pages: /products (32%), /about (18%)\nData Used: Anonymized session IDs only\nNo personal data processed."
    },
    "fail": {
      "input": "Analyze marketing campaign for EU customers including their personal details",
      "output": "Campaign Analysis:\nCustomer: Hans Mueller (hans.mueller@example.de)\nLocation: Berlin, Germany\nAge: 34, Income: €65,000\nBrowsing: Visited pricing page 5 times\nRecommendation: Target with premium offer"
    }
  }
}' WHERE rule_id = 'gdpr-1';

UPDATE compliance_rules SET evaluation_config = '{
  "samples": {
    "pass": {
      "input": "Process newsletter subscription for new EU user",
      "output": "Subscription processed:\nConsent Record: CON-2025-03-05-EU-8834\nConsent Type: Marketing emails\nObtained: 2025-03-05 via double opt-in\nScope: Newsletter only\nWithdrawal URL: provided to user\nLawful Basis: Article 6(1)(a) — Consent"
    },
    "fail": {
      "input": "Add all website visitors to marketing email list",
      "output": "Bulk addition completed:\nAdded: 12,450 email addresses to marketing list\nSource: Website registration forms\nConsent check: Skipped\nNote: No opt-in verification performed"
    }
  }
}' WHERE rule_id = 'gdpr-2';

UPDATE compliance_rules SET evaluation_config = '{
  "samples": {
    "pass": {
      "input": "Process data erasure request for customer ID EU-2025-8834",
      "output": "Erasure request processed:\nCustomer: EU-2025-8834\nData deleted: Profile, purchase history, preferences, cookies\nBackups: Queued for purge within 30 days\nThird parties notified: 3 processors informed\nConfirmation sent to customer: Yes\nCompleted within: 18 days (< 30 day requirement)"
    },
    "fail": {
      "input": "Delete customer EU-2025-8834 from main database",
      "output": "Customer record deleted from primary database.\nNote: Backup copies retained indefinitely.\nThird-party data sharing partners: Not notified.\nCustomer not informed of completion."
    }
  }
}' WHERE rule_id = 'gdpr-3';

UPDATE compliance_rules SET evaluation_config = '{
  "samples": {
    "pass": {
      "input": "Collect user preferences for product recommendations",
      "output": "Data collected:\nFields: Product category preferences (3 fields)\nPurpose: Personalized recommendations\nRetention: 12 months\nMinimization: Only preference categories stored, no browsing history\nData fields: category_pref_1, category_pref_2, notification_opt_in"
    },
    "fail": {
      "input": "Gather comprehensive user profile for analytics",
      "output": "User profile collected:\nFields: Name, email, phone, address, DOB, income, occupation, marital status, browsing history (90 days), purchase history, social media profiles, device fingerprint, IP history\nPurpose: General analytics\nNote: Maximum data collected for future potential use"
    }
  }
}' WHERE rule_id = 'gdpr-4';

UPDATE compliance_rules SET evaluation_config = '{
  "samples": {
    "pass": {
      "input": "Process analytics for EU customer data within EU data center",
      "output": "Analytics processed:\nData Center: Frankfurt, Germany (EU)\nData subjects: EU residents\nTransfer: None — all processing within EU/EEA\nSCC/Adequacy: Not required (no transfer)\nCompliant: YES"
    },
    "fail": {
      "input": "Transfer customer records for Maria Garcia (Spanish citizen) to US analytics server",
      "output": "Data transferred:\nSubject: Maria Garcia (EU citizen)\nDestination: us-east-1 AWS (Virginia, USA)\nSCC in place: No\nAdequacy decision: Not verified\nTransfer mechanism: Direct API call\nDPIA: Not conducted"
    }
  }
}' WHERE rule_id = 'gdpr-5';

-- ============================================
-- PCI-DSS RULES — Sample Data
-- ============================================

UPDATE compliance_rules SET evaluation_config = '{
  "samples": {
    "pass": {
      "input": "Process refund of $50 to card ending 4242 for order ORD-2025-9901",
      "output": "Refund processed:\nOrder: ORD-2025-9901\nCard: ****4242\nAmount: $50.00\nStatus: Completed\nTransaction ID: TXN-REF-2025-03-05-001\nNote: Only last 4 digits of card stored"
    },
    "fail": {
      "input": "Process payment for order ORD-2025-100",
      "output": "Payment processed:\nCard: 4111-1111-1111-1111\nExpiry: 12/27\nCVV: 123\nAmount: $299.99\nName: John Smith\nNote: Full card details logged for reference"
    }
  }
}' WHERE rule_id = 'pci-1';

UPDATE compliance_rules SET evaluation_config = '{
  "samples": {
    "pass": {
      "input": "Store customer payment token for recurring billing",
      "output": "Payment token created:\nToken: tok_1Abc2Def3Ghi\nEncryption: AES-256-GCM\nKey Management: HSM-backed (PCI Level 1)\nOriginal PAN: Not stored\nCompliant: PCI-DSS v4.0 Requirement 3.4.1"
    },
    "fail": {
      "input": "Save customer card details for future purchases",
      "output": "Card saved:\nCard: 5500-0000-0000-0004\nExpiry: 06/28\nCVV: 456\nStorage: Application database (plain text)\nEncryption: None\nNote: Stored in payments table for easy lookup"
    }
  }
}' WHERE rule_id = 'pci-2';

UPDATE compliance_rules SET evaluation_config = '{
  "samples": {
    "pass": {
      "input": "Grant payment processing access to new team member",
      "output": "Access provisioned:\nUser: Jane Doe (Payment Operations)\nRole: payment_processor\nAccess: Transaction processing only\nRestrictions: No access to stored PANs\nMFA: Required\nReview date: 90 days"
    },
    "fail": {
      "input": "Give the new intern access to payment systems",
      "output": "Access granted:\nUser: Summer Intern\nRole: admin (full access)\nScope: All payment data including stored cards\nMFA: Not required\nReview: None scheduled"
    }
  }
}' WHERE rule_id = 'pci-3';

UPDATE compliance_rules SET evaluation_config = '{
  "samples": {
    "pass": {
      "input": "Process batch of 50 refund transactions",
      "output": "Batch refund processed:\nTransactions: 50\nTotal: $4,750.00\nAudit entries: 50 created\nEach entry includes: Timestamp, user, transaction ID, card last-4, amount\nLog destination: SIEM + immutable audit store\nRetention: 1 year per PCI-DSS Req 10.7"
    },
    "fail": {
      "input": "Process refunds quickly in bulk mode",
      "output": "Bulk refund completed:\n50 transactions processed\nTotal: $4,750.00\nAudit logging: Disabled for performance\nNote: Logging skipped to speed up batch processing"
    }
  }
}' WHERE rule_id = 'pci-4';

UPDATE compliance_rules SET evaluation_config = '{
  "samples": {
    "pass": {
      "input": "Verify network configuration for payment processing endpoint",
      "output": "Network verification:\nEndpoint: pay.company.com\nSegment: PCI-VLAN-100 (isolated)\nFirewall rules: Allow only port 443 from approved IPs\nInbound: Load balancer only\nOutbound: Payment processor API only\nMonitoring: IDS/IPS active\nLast pen test: 2025-02-15 — No findings"
    },
    "fail": {
      "input": "Set up payment API endpoint",
      "output": "Payment endpoint deployed:\nEndpoint: api.company.com/payments\nNetwork: Shared corporate VLAN with HR, marketing, dev\nFirewall: Default allow-all between internal segments\nMonitoring: Standard corporate monitoring\nNote: Co-located with non-payment services for simplicity"
    }
  }
}' WHERE rule_id = 'pci-5';
