terraform {
  required_version = ">= 1.5"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.6"
    }
    null = {
      source  = "hashicorp/null"
      version = "~> 3.2"
    }
  }

  # Local state by default (terraform.tfstate, gitignored) -- fine for a
  # single-account, single-operator setup. Add an S3 backend block here if
  # more than one person needs to run `terraform apply`.
}

provider "aws" {
  region = local.region
  # Uses the AWS default profile / credential chain -- no profile pinned here.
}
